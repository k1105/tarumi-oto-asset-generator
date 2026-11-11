// 置き場所。アプリは sns/ で動かす (process.cwd())
import path from 'node:path';

export const ROOT = process.cwd(); // sns/
export const TOP = path.join(ROOT, '..'); // tarumi-tetsudo/
export const DATA = path.join(ROOT, 'data');

export const PROJECTS = path.join(DATA, 'projects'); // 編集中のデータ (1 つ 1 ファイルの JSON)
export const ASSETS = path.join(DATA, 'assets'); // 画面に落とした画像・動画
export const CACHE = path.join(DATA, 'cache'); // 写真の縮小コピー (消しても作り直される)
export const TEMPLATES = path.join(ROOT, 'templates'); // レイアウトのテンプレート (プロジェクトと同じ形の JSON)
export const PHOTOS = path.join(TOP, 'docs', 'photo', 'selected'); // 樽見の写真 (<区分>/*.JPG)
