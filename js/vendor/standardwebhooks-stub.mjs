// Anthropic SDK が webhook の署名確認に使う standardwebhooks の代わり。
// このアプリは webhook を受け取らないので、読み込みを通すためだけに置く（呼ばれたらエラーにする）
export class Webhook {
  constructor() {
    throw new Error('webhook の確認はこのアプリでは使えません');
  }
}
