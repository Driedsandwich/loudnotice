# SoundSense 引き渡しメモ

- Features 1〜8 を実装しました。静的 HTML / CSS / ES modules で、ビルドは不要です。
- マイク入力・6種類のサンプル・12種類の通知グループ・全画面通知・履歴・独自音の学習と JSON 入出力・設定・説明画面を含みます。
- YAMNet は maxResults: 521 / scoreThreshold: 0 で全分類を取得し、categoryName 順にそろえます。学習には521分類と32帯域の周波数特徴を使用します。
- `python3 -m py_compile tests/smoke_test.py` は成功しました。ブラウザ、Node、ブラウザ操作ツールは使用せず、インストールも行っていません。
- 未確認：実ブラウザでの動作、実際の分類精度、スマホの振動・通知、画面の見た目と支援技術での操作。README の「Planned / incomplete」に記載しています。
- 別の機械で `python3 tests/smoke_test.py` を実行してください。Python Playwright と Chromium が既にある環境を想定しています。
- 手動確認は `python3 -m http.server 8000` で起動し、localhost:8000 を開いてください。マイク許可／拒否・停止、狭い画面、通知、学習データの再読込を確認してください。
- ケトルも Alarm と分類されることがあり、煙警報の表示が優先されます。同時に成立した判定は履歴に残ります。試作品は認定警報器の代わりにはなりません。
- ハッカソンへの提出は行っていません。提出前に README の AI-assistance note の人間の著作者情報等を補ってください。
