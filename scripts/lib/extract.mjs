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
  const iconLabels = [];
  const listRenderers = [];
  const defaultFonts = [];
  traverse(ast, {
    VariableDeclarator(p) {
      const n = p.node;
      if (
        t.isConditionalExpression(n.init) &&
        t.isMemberExpression(n.init.test?.left) &&
        key(n.init.test.left) === "font" &&
        t.isConditionalExpression(n.init.alternate) &&
        t.isStringLiteral(n.init.alternate.consequent) &&
        t.isNullLiteral(n.init.alternate.alternate)
      ) {
        defaultFonts.push(n.init.alternate.consequent.value);
      }
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
      if (
        ["iconNameLines", "iconNameScale", "measureText", "strokeText"].every(
          (k) => seen.has(k),
        )
      )
        iconLabels.push(p);
      if (
        p.node.params.length === 3 &&
        ["Hh", "offsetTop", "scrollTop", "showIcons", "strokeText"].every((k) =>
          seen.has(k),
        )
      )
        listRenderers.push(p);
    },
  });
  const raw = unique(rawRecipes, "recipe text");
  const rarity = unique(rarityArrays, "rarity table");
  const iconBody = unique(iconBodies, "icon body renderer");
  const iconLabel = unique(iconLabels, "icon name renderer");
  const listRenderer = unique(listRenderers, "slot canvas renderer");
  const font = unique([...new Set(defaultFonts)], "production default font");
  const replacements = new Map();
  const hostBindings = new Map();
  const bindHost = (p, name, value) => {
    const binding = p.scope.getBinding(name);
    if (!binding) throw new Error(`Missing Canvas adapter binding: ${name}`);
    hostBindings.set(
      binding.path.node,
      t.variableDeclarator(t.identifier(name), value),
    );
  };
  const hostMember = (name) =>
    t.memberExpression(t.identifier("host"), t.identifier(name));
  const tileSizes = new Set();
  const quantityGuards = [];
  listRenderer.traverse({
    CallExpression(p) {
      const n = p.node;
      if (
        t.isIdentifier(n.callee) &&
        t.isStringLiteral(n.arguments[0]) &&
        n.arguments[0].value.startsWith("<canvas")
      )
        bindHost(
          p,
          n.callee.name,
          t.arrowFunctionExpression([], hostMember("canvas")),
        );
      if (!t.isMemberExpression(n.callee)) return;
      if (
        key(n.callee) === "on" &&
        t.isStringLiteral(n.arguments[0], { value: "sprite_rendered" })
      )
        bindHost(
          p,
          n.callee.object.name,
          t.objectExpression([
            t.objectMethod(
              "method",
              t.identifier("on"),
              [],
              t.blockStatement([]),
            ),
          ]),
        );
      if (key(n.callee) === "drawImage")
        bindHost(p, n.arguments[0].name, hostMember("atlas"));
      const scale = n.arguments[0];
      if (
        key(n.callee) === "As" &&
        t.isBinaryExpression(scale, { operator: "/" }) &&
        t.isMemberExpression(scale.left) &&
        key(scale.left) === "offsetWidth" &&
        t.isNumericLiteral(scale.right)
      )
        tileSizes.add(scale.right.value);
    },
    MemberExpression(p) {
      if (key(p.node) === "showIcons")
        bindHost(
          p,
          p.node.object.name,
          t.objectExpression([
            t.objectProperty(t.identifier("showIcons"), t.booleanLiteral(true)),
          ]),
        );
      if (
        p.node.computed &&
        t.isIdentifier(p.node.object) &&
        generate(p.node.property).code.includes("petal-")
      )
        bindHost(p, p.node.object.name, hostMember("mapping"));
    },
    IfStatement(p) {
      const test = p.node.test;
      if (
        t.isBinaryExpression(test, { operator: ">" }) &&
        t.isMemberExpression(test.left) &&
        key(test.left) === "Hh" &&
        t.isNumericLiteral(test.right, { value: 1 })
      )
        quantityGuards.push(test);
      if (
        t.isIdentifier(p.node.test) &&
        generate(p.node.consequent).code.includes("rendering icons:")
      )
        bindHost(p, p.node.test.name, t.booleanLiteral(false));
    },
  });
  // Viewer requirement: include x1 using the original quantity drawing code.
  unique(quantityGuards, "quantity visibility guard").operator = ">=";
  iconLabel.traverse({
    AssignmentExpression(p) {
      const n = p.node;
      if (
        t.isMemberExpression(n.left) &&
        key(n.left) === "font" &&
        t.isBinaryExpression(n.right) &&
        t.isIdentifier(n.right.right)
      ) {
        const b = p.scope.getBinding(n.right.right.name);
        replacements.set(b.path.node, t.stringLiteral(JSON.stringify(font)));
      }
    },
    CallExpression(p) {
      const n = p.node;
      if (
        t.isIdentifier(n.callee) &&
        t.isStringLiteral(n.arguments[0], { value: "petals" }) &&
        t.isStringLiteral(n.arguments[2], { value: "name" })
      ) {
        const b = p.scope.getBinding(n.callee.name);
        replacements.set(
          b.path.node,
          t.arrowFunctionExpression(
            [
              t.identifier("category"),
              t.identifier("item"),
              t.identifier("field"),
            ],
            t.memberExpression(
              t.identifier("item"),
              t.identifier("field"),
              true,
            ),
          ),
        );
      }
    },
  });
  const iconSizes = new Set();
  for (const ref of iconBody.scope.getBinding(iconBody.node.id.name)
    .referencePaths) {
    if (!ref.parentPath.isCallExpression()) continue;
    for (let p = ref.parentPath.parentPath; p; p = p.parentPath) {
      if (!p.isBlockStatement()) continue;
      const sizes = new Set();
      p.traverse({
        CallExpression(q) {
          const n = q.node,
            a = n.arguments[0];
          if (
            n.start < ref.node.start &&
            t.isMemberExpression(n.callee) &&
            key(n.callee) === "As" &&
            t.isBinaryExpression(a, { operator: "/" }) &&
            t.isNumericLiteral(a.left, { value: 1 }) &&
            t.isNumericLiteral(a.right)
          )
            sizes.add(a.right.value);
        },
      });
      if (sizes.size) {
        if (sizes.size === 1) iconSizes.add([...sizes][0]);
        break;
      }
    }
  }
  const iconSize = unique([...iconSizes], "icon design size");
  const tileSize = unique([...tileSizes], "slot design size");
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
        if (hostBindings.has(b.path.node)) return;
        let declaration;
        if (replacements.has(b.path.node)) {
          declaration = t.variableDeclaration("const", [
            t.variableDeclarator(
              t.identifier(q.node.name),
              replacements.get(b.path.node),
            ),
          ]);
        } else if (b.path.isFunctionDeclaration()) declaration = b.path.node;
        else if (b.path.isVariableDeclarator())
          declaration = t.variableDeclaration("const", [b.path.node]);
        else throw new Error(`Unsupported renderer dependency: ${q.node.name}`);
        extras.set(b.path.node, declaration);
        if (!replacements.has(b.path.node)) collect(b.path);
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
  extras.set(iconLabel.node, iconLabel.node);
  collect(iconLabel);
  collect(listRenderer);
  for (const override of overrides) collect(override);
  if (!propertyName) throw new Error("Petal property evaluator was not found");
  const factory = t.functionDeclaration(
    t.identifier("paintSlot"),
    [t.identifier("host")],
    t.blockStatement([
      ...parse("const ResizeObserver=class{observe(){}};").program.body,
      t.variableDeclaration("const", [...hostBindings.values()]),
      listRenderer.node,
      ...parse(
        `const list=new ${listRenderer.node.id.name}(host.grid,true);list.reset();list.draw();return list.canvas;`,
        { allowReturnOutsideFunction: true },
      ).program.body,
    ]),
  );
  const exportCode = `globalThis.result={petals:${petalName},rarities:${rarity.node.id.name},recipes:${recipeName},property:${propertyName},draw:${iconBody.node.id.name},label:${iconLabel.node.id.name},paintSlot};`;
  const code = generate(
    t.program([
      ...prefix,
      ...extras.values(),
      ...overrides.map((p) => t.expressionStatement(p.node)),
      factory,
    ]),
    { comments: false },
  ).code;
  const context = vm.createContext({
    Path2D,
    console: { log() {} },
    window: { IS_PROD: true, devicePixelRatio: 2 },
    ResizeObserver: class {
      observe() {}
    },
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
    runtimeCode: code + "\n" + exportCode,
    superRarity,
    intervalMs: schedule.intervalMs,
    rendering: { iconSize, tileSize, font },
    extraction: {
      apiAliases: aliases.size,
      recipeLine: raw.node.loc.start.line,
      rotationLine: schedule.line,
      rendererLine: iconBody.node.loc.start.line,
      labelLine: iconLabel.node.loc.start.line,
      slotRendererLine: listRenderer.node.loc.start.line,
    },
  };
}
