import vm from "node:vm";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import generateModule from "@babel/generator";
import * as t from "@babel/types";

const traverse = traverseModule.default ?? traverseModule;
const generate = generateModule.default ?? generateModule;
const key = (n) => (n?.computed ? n.property?.value : n?.property?.name);
const unique = (items, label) => {
  if (items.length !== 1)
    throw new Error(
      `Expected one ${label}, found ${items.length}. Upstream code needs review.`,
    );
  return items[0];
};
const contains = (outer, inner) =>
  outer.start <= inner.start && outer.end >= inner.end;

// Structural anchors, not minified identifiers or bundle names. Ambiguity is a build error.
export function extract(source, { Path2D }) {
  const ast = parse(source, { sourceType: "script" });
  const aliases = new Map();
  traverse(ast, {
    CallExpression(p) {
      const n = p.node;
      if (
        !t.isMemberExpression(n.callee) ||
        key(n.callee) !== "parse" ||
        !t.isIdentifier(n.callee.object, { name: "JSON" })
      )
        return;
      const arg = n.arguments[0];
      if (
        !t.isCallExpression(arg) ||
        !t.isIdentifier(arg.callee, { name: "atob" }) ||
        !t.isStringLiteral(arg.arguments[0])
      )
        return;
      let map;
      try {
        map = JSON.parse(
          Buffer.from(arg.arguments[0].value, "base64").toString("utf8"),
        );
      } catch {
        return;
      }
      if (!map || Array.isArray(map) || typeof map !== "object") return;
      const pairs = Object.entries(map);
      if (
        !pairs.length ||
        !pairs.every(
          ([from, to]) =>
            /^[\w$]+$/.test(from) &&
            typeof to === "string" &&
            /^\$\d+$/.test(to),
        )
      )
        return;
      for (const [from, to] of pairs) {
        if (aliases.has(to) && aliases.get(to) !== from)
          throw new Error(`Conflicting API alias ${to}`);
        aliases.set(to, from);
      }
    },
  });
  traverse(ast, {
    MemberExpression(p) {
      const name = aliases.get(key(p.node));
      if (name) {
        p.node.property = t.identifier(name);
        p.node.computed = false;
      }
    },
  });

  const rawRecipes = [];
  const rarityArrays = [];
  const iconBodies = [];
  traverse(ast, {
    VariableDeclarator(p) {
      const n = p.node;
      if (
        t.isStringLiteral(n.init) &&
        /^\s*(?:[a-z0-9_]+ [1-9]\d*\n)+-\n/.test(n.init.value)
      )
        rawRecipes.push(p);
      if (
        t.isArrayExpression(n.init) &&
        n.init.elements.length > 1 &&
        n.init.elements.every(
          (e) =>
            t.isArrayExpression(e) &&
            t.isStringLiteral(e.elements[0]) &&
            t.isStringLiteral(e.elements[1]) &&
            /^#[a-f\d]{6}$/i.test(e.elements[1].value),
        )
      )
        rarityArrays.push(p);
    },
    FunctionDeclaration(p) {
      const seen = new Set();
      p.traverse({
        MemberExpression(q) {
          seen.add(key(q.node));
        },
      });
      if (
        p.node.params.length === 3 &&
        ["iconScale", "iconX", "iconY"].every((k) => seen.has(k))
      )
        iconBodies.push(p);
    },
  });
  const raw = unique(rawRecipes, "recipe text");
  const rarity = unique(rarityArrays, "rarity table");
  const iconBody = unique(iconBodies, "icon body renderer");
  const dataScope = raw.scope;
  const dataBlock = dataScope.path.node.body;
  if (!t.isBlockStatement(dataBlock))
    throw new Error("Recipe data scope is not a function body");

  // Locate the recipe parser through the recipe text reference; follow any function aliases.
  const recipeParsers = new Set(
    dataScope
      .getBinding(raw.node.id.name)
      .referencePaths.map((p) => p.getFunctionParent())
      .filter(Boolean)
      .map((p) => p.node),
  );
  function definition(binding) {
    if (binding?.path.isFunctionDeclaration()) return binding.path.node;
    if (
      binding?.path.isVariableDeclarator() &&
      t.isIdentifier(binding.path.node.init)
    ) {
      return definition(
        binding.path.scope.getBinding(binding.path.node.init.name),
      );
    }
  }
  const recipeInitializers = [];
  for (const statement of dataBlock.body) {
    if (!t.isVariableDeclaration(statement)) continue;
    for (const d of statement.declarations) {
      if (
        t.isCallExpression(d.init) &&
        t.isIdentifier(d.init.callee) &&
        recipeParsers.has(
          definition(dataScope.getBinding(d.init.callee.name)),
        ) &&
        d.init.arguments.length === 1 &&
        t.isIdentifier(d.init.arguments[0])
      )
        recipeInitializers.push({ d, statement });
    }
  }
  const recipeInit = unique(recipeInitializers, "recipe initialization");
  const petalName = recipeInit.d.init.arguments[0].name;
  const recipeName = recipeInit.d.id.name;
  const prefix = dataBlock.body
    .slice(0, dataBlock.body.indexOf(recipeInit.statement) + 1)
    .flatMap((statement) => {
      if (!t.isVariableDeclaration(statement)) return [statement];
      // The residual outer decoder alias is not part of the data initializer.
      const declarations = statement.declarations.filter(
        (d) =>
          !(
            t.isIdentifier(d.init) &&
            dataScope.getBinding(d.init.name) &&
            dataScope.getBinding(d.init.name).scope !== dataScope
          ),
      );
      return declarations.length
        ? [t.variableDeclaration(statement.kind, declarations)]
        : [];
    });
  const prefixEnd = recipeInit.statement.end;
  const extras = new Map();
  const overrides = [];
  const scheduleCandidates = [];
  let propertyName;
  traverse(ast, {
    AssignmentExpression(p) {
      const n = p.node.left;
      if (
        t.isMemberExpression(n) &&
        key(n) === "draw" &&
        t.isMemberExpression(n.object) &&
        t.isIdentifier(n.object.object, { name: petalName })
      )
        overrides.push(p);
    },
    MemberExpression(p) {
      const n = p.node;
      if (
        !n.computed ||
        !t.isIdentifier(n.object, { name: recipeName }) ||
        !t.isBinaryExpression(n.property, { operator: "%" })
      )
        return;
      const rhs = n.property.right;
      if (
        !t.isMemberExpression(rhs) ||
        key(rhs) !== "length" ||
        !t.isIdentifier(rhs.object, { name: recipeName })
      )
        return;
      const fn = p.getFunctionParent();
      if (!fn || !t.isIdentifier(n.property.left)) return;
      const hourBinding = p.scope.getBinding(n.property.left.name);
      const floor = hourBinding?.path.node.init;
      if (
        !t.isCallExpression(floor) ||
        !t.isMemberExpression(floor.callee) ||
        key(floor.callee) !== "floor"
      )
        return;
      const division = floor.arguments[0];
      if (
        !t.isBinaryExpression(division, { operator: "/" }) ||
        !t.isIdentifier(division.left) ||
        !t.isIdentifier(division.right)
      )
        return;
      const nowBinding = p.scope.getBinding(division.left.name);
      const now = nowBinding?.path.node.init;
      if (
        !t.isCallExpression(now) ||
        !t.isMemberExpression(now.callee) ||
        key(now.callee) !== "now" ||
        !t.isIdentifier(now.callee.object, { name: "Date" })
      )
        return;
      const intervalBinding = p.scope.getBinding(division.right.name);
      const value = intervalBinding?.path.get("init").evaluate();
      if (
        !value?.confident ||
        !Number.isSafeInteger(value.value) ||
        value.value <= 0 ||
        !intervalBinding.constant
      )
        return;
      scheduleCandidates.push({
        intervalMs: value.value,
        line: fn.node.loc.start.line,
      });
    },
  });
  const schedule = unique(scheduleCandidates, "epoch-based recipe rotation");

  // Copy only renderer dependencies outside the already initialized data scope.
  // No UI initialization, network code, or game loop reaches the generated site.
  function collect(p) {
    p.traverse({
      ReferencedIdentifier(q) {
        const b = q.scope.getBinding(q.node.name);
        if (
          !b ||
          contains(p.node, b.path.node) ||
          (b.scope === dataScope && b.path.node.end <= prefixEnd)
        )
          return;
        if (extras.has(b.path.node)) return;
        let declaration;
        if (b.path.isFunctionDeclaration()) declaration = b.path.node;
        else if (b.path.isVariableDeclarator())
          declaration = t.variableDeclaration("const", [b.path.node]);
        else throw new Error(`Unsupported renderer dependency: ${q.node.name}`);
        extras.set(b.path.node, declaration);
        collect(b.path);
      },
      CallExpression(q) {
        if (
          t.isStringLiteral(q.node.arguments[1], { value: "count" }) &&
          t.isIdentifier(q.node.callee)
        ) {
          propertyName ??= q.node.callee.name;
        }
      },
    });
  }
  extras.set(iconBody.node, iconBody.node);
  collect(iconBody);
  for (const override of overrides) collect(override);
  if (!propertyName) throw new Error("Petal property evaluator was not found");
  const exportCode = `globalThis.result={petals:${petalName},rarities:${rarity.node.id.name},recipes:${recipeName},property:${propertyName},draw:${iconBody.node.id.name}};`;
  const code = generate(
    t.program([
      ...prefix,
      ...extras.values(),
      ...overrides.map((p) => t.expressionStatement(p.node)),
    ]),
    { comments: false },
  ).code;
  const context = vm.createContext({
    Path2D,
    console: { log() {} },
    window: { IS_PROD: true },
  });
  vm.runInContext(code + "\n" + exportCode, context, {
    timeout: 30_000,
    filename: "extracted-zorr-data.js",
  });
  const data = context.result;
  // Explicit schema checks prevent silently publishing partially extracted recipes.
  if (
    !Array.isArray(data.recipes) ||
    !data.recipes.length ||
    !Array.isArray(data.petals)
  )
    throw new Error("Invalid recipe registry");
  for (const [index, recipe] of data.recipes.entries()) {
    if (recipe.id !== index || !recipe.inputs.length || !recipe.outputs.length)
      throw new Error("Invalid recipe sequence");
    for (const item of [...recipe.inputs, ...recipe.outputs]) {
      if (
        data.petals[item.petal.id] !== item.petal ||
        !Number.isSafeInteger(item.count) ||
        item.count < 1 ||
        typeof item.petal.draw !== "function"
      )
        throw new Error("Invalid recipe item");
    }
  }
  const superRarity = data.rarities.find((r) => r.slug === "super");
  if (!superRarity || !/^#[\da-f]{6}$/i.test(superRarity.color))
    throw new Error("Super rarity was not found");
  return {
    ...data,
    superRarity,
    intervalMs: schedule.intervalMs,
    extraction: {
      apiAliases: aliases.size,
      recipeLine: raw.node.loc.start.line,
      rotationLine: schedule.line,
      rendererLine: iconBody.node.loc.start.line,
    },
  };
}
