<img src="assets/icon.svg" width="56" height="56" alt="">

# Zorr Assembler

現在のレシピから一巡分の Assembler レシピを時刻順に並べる最小構成の Web viewer。表示はレシピ・時間帯・残り時間（現在のレシピ）・何時間後に始まるか（以降のレシピ）だけです。

- Super カラー、合成1回分の材料・成果物の個数で固定。個数・レアリティの入力はありません。
- アイコン内の本体数はペタルごとの最少値。元の Canvas 関数で背景・本体・枠内の名前・右上の傾いた数量ラベルまで描画します。元の関数は1個の数量ラベルを省略しますが、表示条件だけを変えて `x1` も描画します。
- 時刻は端末の時計とタイムゾーンで表示し、時刻でレシピを自動で切り替えます。
- Cloudflare Pages 向けの静的サイト。ブラウザーからゲームのサーバーに接続する必要はありません。

## 開発

Node.js は [.node-version](.node-version) のバージョンを使用します。

```sh
npm ci
npm run build
npm test
npm run dev
```

`http://localhost:4173` を開きます。`dev` / `preview` は生成済みの `dist/` だけを配信します。画面を変更したら `npm run build` を再実行してください。

## ビルド時のデータ取得

`npm run build` は毎回次の処理を行います。

1. `https://zorr.pages.dev/` と、そこに指定された最新のゲーム JavaScript を取得。
2. [zorr-deobfuscator](https://github.com/suicanifuramu/zorr-deobfuscator) を実行。解除処理だけは取得したソースの SHA-256 とエンジンのバージョンが一致するときに限り `.cache/` を再利用。
3. AST の構造からレシピ、レアリティ表、API 別名、本体・名前・一覧の Canvas 描画関数、既定フォント、実際のレシピ切り替え周期を抽出。
4. ヘッドレス Chromium（[@sparticuz/chromium](https://github.com/Sparticuz/chromium)）上で、取得したフォントと元の関数を使い、Super の背景・最少の本体数・名前・1回分の数量ラベルを PNG に描画。名前と個数を別の HTML で描き直しません。`@napi-rs/canvas` は `save()`/`restore()` をまたいで回転・反転したパス（Kitty の耳、Nuke の扇形、Plasma の稲妻など）を誤った位置に描くため、描画には使いません。
5. JSON・画像・CSS・JavaScript に内容のハッシュを付け、静的な `dist/` を生成。

レシピ、個数、色、周期、配信ファイル名をアプリに固定していません。`research/data/` は調査記録であり、製品ビルドから参照しません。取得先・取得日時・ソース SHA-256 は生成 JSON に記録されます。

取得失敗や、元コードの構造変更で抽出結果が不明確になった場合は、固定データにフォールバックせずビルドを失敗させます。新しい配信に対応できない場合は抽出処理の確認が必要です。ゲーム更新の反映には再ビルドが必要で、時刻によるレシピ切り替えは再ビルドなしで動きます。

主な実装は [ビルド](scripts/build.mjs)、[抽出](scripts/lib/extract.mjs)、[描画アダプター](scripts/lib/paint.mjs)、[Chromium 描画](scripts/lib/browser.mjs)、[時刻計算](src/schedule.mjs)、[画面](src/app.js) に分けています。解除エンジンは公開 HTTPS アーカイブとコミットで固定してあり、CI で GitHub SSH 鍵は必要ありません。

## Cloudflare Pages

GitHub リポジトリを Pages に接続し、次の設定でビルドします。

| 項目                   | 値                     |
| ---------------------- | ---------------------- |
| Framework preset       | None                   |
| Build command          | `npm run build`        |
| Build output directory | `dist`                 |
| Root directory         | リポジトリ直下         |
| Node.js                | `.node-version` を使用 |

[wrangler.toml](wrangler.toml) に `pages_build_output_dir` を指定済み。[public/_headers](public/_headers) で CSP と静的アセットのキャッシュを設定しています。API キーや実行時のサーバー、DB は不要です。

Pages のローカル環境で確認する場合:

```sh
npx wrangler pages dev dist
```

参考: [Pages のビルド設定](https://developers.cloudflare.com/pages/configuration/build-configuration/)、[Node.js のバージョン指定](https://developers.cloudflare.com/pages/configuration/build-image/)。

## 短時間の公開テスト

`cloudflared` をインストールし、`dist/` を生成した状態で:

```sh
npm run tunnel
```

生成物専用のサーバーと Quick Tunnel を起動し、表示された `https://….trycloudflare.com` で確認できます。30分後に両方を自動停止します。`Ctrl+C` でも停止できます。既定のポートは4173です。

```sh
PORT=4175 TUNNEL_MINUTES=10 npm run tunnel
```

これは一時 URL です。恒久公開には Cloudflare Pages を使用します。[Quick Tunnel の仕様](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。

## 調査記録

- [Assembler とペタルアイコンの仕様](research/specification.md)
- [レシピ時刻の仕様](research/recipe-timing.md)
- [インベントリ・クラフトの複数描画](research/bulk-rendering.md)
- [調査時点の49レシピ](research/data/recipes.md)
- [抽出データと検証結果・再現手順](research/README.md)

調査資料は2026-10-18時点のスナップショットです。アプリはビルド時点の配信データを使用します。
