# LoudNotice 引き渡しメモ

既存のダッシュボードの構成・配色・通知画面を保って改修しました。成果物フォルダ直下に、そのまま配信できるサイト一式と `changes.patch` を置いています。作業元の repo にも変更を反映しています。

## 変更点

- 表示名、タイトル、README、LICENSE、説明・試験スクリプトの表示を LoudNotice に統一。副題は “See the sounds that matter.”。
- `window.loudnotice` を公開し、`window.soundsense` も同じオブジェクトへの別名として維持。旧保存データの読み取りと、旧テストが参照する保存キーへの互換書き込みも維持。
- 全組み込みグループで、1窓のスコアが感度調整後のしきい値＋0.10以上なら即通知。従来の「3窓中2窓」と6秒のクールダウンも維持。
- ノックの合成スクリプトを3回×2組・4秒へ変更。**この環境には NumPy がないため、許可された例外に従い `sounds/knock.wav` は再生成していません。**
- Station mode：ボタンで入室、必要ならマイク開始、全画面／画面いっぱいの代替表示、画面の消灯防止と未対応・拒否時の説明、大きな時計・聞き取り状態・最新通知・入室後の群別件数。Esc・退出ボタン・`station(false)` で退出。通知は既存の全画面表示。退出時に Wake Lock を解放し、開始済みの聞き取りは継続（通常画面の Stop で停止）。
- 家族向け3段階の案内と Export setup / Import setup。版番号付き v2 JSON に、学習済み特徴量、各音の情報・しきい値・有効状態、群の切替、感度、振動、通知、動きを抑える設定を収録。音声は含めず、読み込み前に全体を検証。読み込みは音と設定を置換。旧 v1 音のみのファイルも読み込み可能。
- While you were away の説明と、復帰時に画面上部に出る要約を追加。非表示／フォーカスを外した間の検出件数を、履歴200件の上限と独立に集計。
- smoke test に名称・旧 API の互換性、Station の出入り・画面占有・通知と件数・API 未対応／拒否、設定ファイルの実ダウンロード→変更→読み込み→復元、不正な設定の拒否を追加。ノックを含む従来の実モデル認識試験は維持。
- README を全面更新。AI 利用の節は指定どおり見出しと `TODO: filled in by the author` のみ。

## 実施した確認

- `python3 -m py_compile tests/smoke_test.py tools/synth_sounds.py`：成功。
- `git diff --check`：成功。
- NumPy の有無確認：未導入。新しいパッケージは導入していません。
- ブラウザ、Node、ブラウザ操作ツールは使用していません。今回の版のブラウザ試験・見た目・認識精度は未確認です。前の HEAD の 11/12 PASS はユーザーからのご報告であり、今回の試験結果ではありません。
- 静的サイトを維持し、外部読み込み先は元の MediaPipe bundle・WASM・YAMNet の3か所のみ。秘密の値、有料 API、解析ツールは追加していません。

## 別の機械で確認してほしいこと

1. Python Playwright と Chromium がある環境で `python3 tests/smoke_test.py` を実行。特に `Sample: knock`、Station mode、設定の往復を確認してください。
2. 実際に置く古い PC／タブレットで、Station の全画面・時計・聞き取り表示・通知・件数・退出・消灯防止を確認。マイク拒否時と、タブを隠して戻した場合も確認してください。
3. 別端末への Export setup → Import setup と再読み込みで音と設定が戻るか確認。通知の許可は端末ごとに必要です。
4. 非表示中に検出があった場合の While you were away、狭い画面や拡大表示、振動・通知・キーボード操作を確認してください。

NumPy がある機械でノックのみを再生成する場合（repo のルートで実行）：

```sh
python3 -c "from tools.synth_sounds import knock, write; write('sounds/knock.wav', knock())"
```

ローカル起動は `python3 -m http.server 8000` → `http://localhost:8000`。別端末からマイクを利用する場合は HTTPS で配信してください。詳しい仕組み、プライバシー、限界は README に記載しています。
