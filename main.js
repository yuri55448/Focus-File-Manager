'use strict';
const obsidian = require('obsidian');
const { Plugin, ItemView, Menu, Notice, Modal, Setting, PluginSettingTab, TFile, TFolder, setIcon, debounce, Platform } = obsidian;
// 手機版沒有 Node 模組：以 try/catch 保護，跨庫剪貼簿只在桌面版可用
let fs = null, nodePath = null, os = null;
try { fs = require('fs'); nodePath = require('path'); os = require('os'); } catch (e) { /* mobile */ }
const HAS_NODE = !!(fs && nodePath && os);

const VIEW_TYPE = 'focus-file-manager-view';
// 跨庫剪貼簿：路徑文字放系統剪貼簿，操作類型(copy/cut)放暫存檔，讓不同庫視窗共用
const CLIP_FILE = HAS_NODE ? nodePath.join(os.tmpdir(), 'obsidian-ffm-clipboard.json') : null;

const DEFAULT_PRESETS = () => [
  { id: 'numbering', name: "Numbering (100, 200…)", type: 'pattern', pattern: '{n} {name}', start: 100, step: 100, pad: 0, find: '', replace: '', regex: false, caseSensitive: true },
  { id: 'replace', name: "Replace characters", type: 'replace', pattern: '{name}', start: 1, step: 1, pad: 0, find: '', replace: '', regex: false, caseSensitive: true },
];

const DEFAULT_SETTINGS = {
  crossLevelMove: true,
  sortMode: 'default', // default | manual
  manualOrder: {},
  pinned: [],
  zones: [], // { id, name, items:[{path, includeSub}] }
  activeZone: null,
  expanded: {},
  show: { folderFileCount: false, folderSubCount: false, extension: false, ctime: false, size: false },
  countExtensions: 'md',
  countRecursive: false,
  metaLayout: 'inline', // inline | below | hybrid
  modeButtonStyle: 'separate', // separate | cycle
  folderArrowOnly: false,
  openViaButton: false,
  doubleClickMs: 300,
  dragAddMode: 'all', // all | level
  openMode: 'current', // current | tab
  showTabButton: true,
  toolbarStyle: 'text', // text | icon | icon-text
  mergeExpandCollapse: true,
  settingsVersion: 2,
  newTabPosition: 'adjacent', // adjacent | end
  hoverInfo: true,
  dimOtherLevels: true,
  dimOpacity: 35,
  fullNameFolder: false,
  fullNameFile: false,
  sizeMode: 'default', // default | custom
  sizeUnit: 'auto',
  sizeDecimals: 1,
  sizeBase: 1024,
  indentGuides: true,
  iconSource: 'auto', // auto | theme | plugin
  guideColor: '',
  guideOpacity: 100,
  guideWidth: 1,
  guideLine: 'solid',
  guideOffset: 12,
  guideCss: '',
  guideStyleName: '',
  guideStyles: [],
  guideStylePath: 'Focus File Manager/guide-style.json',
  sortFoldersFirst: true,
  fullNameWrap: true,
  openIconColor: '',
  openIconOpacity: 100,
  tabIconColor: '',
  tabIconOpacity: 100,
  expandExcludeOn: false,
  expandExclude: '',
  styleTemplates: [],
  language: 'auto',
  langPath: 'Focus File Manager/lang/en.json',
  customLangs: [],
  treeStyle: 'tree', // tree | explorer
  explorerPath: '/',
  fontMode: 'follow', // follow | custom
  fontSize: 13,
  arrowMode: 'auto', // auto | show | hide
  pinIcon: 'pin',
  showBookmarkMark: true,
  bookmarkIcon: 'bookmark',
  newFileTypes: '',
  icons: { collapsed: 'chevron-right', expanded: 'chevron-down', folder: 'folder', folderOpen: 'folder-open', file: 'file' },
  extIcons: '',
  showFolderIcon: true,
  showFileIcon: true,
  nativeClasses: true,
  styles: {}, // path -> { icon, color, bg }
  layoutMode: 'both', // tree | zone | both
  leftWidth: 50,
  viewingMark: { text: '●', color: '紅色' },
  backgroundMark: { text: '■', color: '灰色' },
  colorAliases: '',
  renamePresets: DEFAULT_PRESETS(),
};

const VIEW_MODES = [['tree', "File manager", 'folder'], ['zone', "Focus zone", 'target'], ['both', "Both", 'columns-2|columns']];
function pickIcon(spec) {
  const [a, b] = spec.split('|');
  if (!b) return a;
  try { const ids = obsidian.getIconIds ? obsidian.getIconIds() : []; return ids.includes('lucide-' + a) ? a : b; } catch (e) { return b; }
}

/* ------------------------------ i18n ------------------------------ */
// 以英文原文當作 key。翻譯檔只需要提供「英文 → 該語言」的對照；缺少的 key 一律退回英文。
const LANG_BUILTIN = [['en', 'English'], ['zh-TW', '繁體中文'], ['zh-CN', '简体中文'], ['ja', '日本語']];
const LANG_DATA = {
  "en": {
    "編號（100、200…）": "Numbering (100, 200…)",
    "替換字符": "Replace characters"
  },
  "zh-TW": {
    "Numbering (100, 200…)": "編號（100、200…）",
    "Replace characters": "替換字符",
    "File manager": "文件管理",
    "Focus zone": "專注區",
    "Both": "兩者",
    "Default (Obsidian)": "預設（Obsidian）",
    "Manual order": "手動排序",
    "Name A → Z": "名稱 A → Z",
    "Name Z → A": "名稱 Z → A",
    "Modified: newest first": "編輯時間 新 → 舊",
    "Modified: oldest first": "編輯時間 舊 → 新",
    "Created: newest first": "創建時間 新 → 舊",
    "Created: oldest first": "創建時間 舊 → 新",
    "Solid": "實線",
    "Dashed": "虛線",
    "Dotted": "點線",
    "Double": "雙線",
    "Default (follow theme)": "預設（跟隨主題）",
    "Solid line; color and thickness follow the theme": "實線，顏色與粗細跟隨主題",
    "Light solid": "淡實線",
    "Thin semi-transparent solid line": "半透明的細實線",
    "Thin dashed line": "細虛線",
    "Round-dot line": "圓點線",
    "Double-layer line": "雙層線",
    "Thick solid": "粗實線",
    "Bold, eye-catching line": "醒目的粗線",
    "Compact": "緊湊",
    "Smaller indentation, good for narrow sidebars": "縮排距離較小，適合窄側邊欄",
    "Gradient fade": "漸層淡出",
    "Fades from top to bottom": "由上到下逐漸變淡",
    "Glow": "發光",
    "Soft glow around the line": "線條外圍帶柔光",
    "Rounded thick bar": "圓角粗條",
    "Thick line with rounded ends": "兩端帶圓角的粗線",
    "Imported style": "匯入的樣式",
    "Common": "常用",
    "Files": "檔案",
    "Folders": "資料夾",
    "Arrows": "箭頭",
    "Marks": "標記",
    "Tools": "工具",
    "Life": "生活",
    "Fantasy": "奇幻",
    "Nature": "自然",
    "Search icon name (English)…": "搜尋圖示名稱（英文）…",
    "{0} in total": "共 {0} 個",
    "No matching icons": "找不到符合的圖示",
    "All": "全部",
    "OK": "確定",
    "Please confirm": "請確認",
    "Cancel": "取消",
    "Add to focus zone": "加入專注區",
    "+ New focus zone…": "＋ 新增專注區…",
    "New focus zone name": "新專注區名稱",
    "Folder scope": "文件夾範圍",
    "Include all files and subfolders": "包含此文件夾下所有檔案與子文件夾",
    "Current level files only": "只包含當前層級的文件",
    "Add": "加入",
    "Please enter a focus zone name": "請輸入專注區名稱",
    "Preset": "方案",
    "Add or edit presets in the plugin settings": "可在插件設定中新增、編輯方案",
    "Apply": "套用",
    "Batch rename ({0} items)": "批量重新命名（{0} 個項目）",
    "Name pattern": "名稱格式",
    "Available: {n} number, {name} original name (without extension), {ext} extension, {i} order (1,2,3…)": "可用：{n} 序號、{name} 原名稱（不含副檔名）、{ext} 副檔名、{i} 順序(1,2,3…)",
    "Start number": "起始數字",
    "Step": "遞增",
    "Zero-padding digits": "補零位數",
    "0 means no padding": "0 代表不補零",
    "Find": "尋找",
    "Replace with": "取代為",
    "Use regular expression": "使用正則表達式",
    "Case sensitive": "區分大小寫",
    "Invalid name": "名稱不合法",
    "Duplicate name": "名稱重複",
    "An item with the same name already exists": "已存在同名項目",
    "\"{0}\" → \"{1}\": {2}": "「{0}」→「{1}」：{2}",
    "No items to rename": "沒有要重新命名的項目",
    "Remove from this batch rename": "從這次批量重新命名中移除",
    "Renamed {0} items": "已重新命名 {0} 個項目",
    "Rename failed: ": "重新命名失敗：",
    "Choose icon": "選擇圖示",
    "Appearance ({0} items)": "外觀設定（{0} 個項目）",
    "Click an icon or template below to apply it immediately. You can also type a Lucide name, an icon ID registered by another plugin, or an emoji. Colors accept names (red), RGB (255,0,0) or HEX (#FF0000).": "點下方圖示或模板會立即套用。圖示也可手動輸入 Lucide 名稱、其他插件註冊的圖示 ID 或 emoji。顏色可填名稱（紅色、red）、RGB（255,0,0）或 HEX（#FF0000）。",
    "My templates": "我的模板",
    "(No templates saved yet)": "（尚未儲存任何模板）",
    "Click to apply this template": "點擊套用此模板",
    "Delete this template": "刪除此模板",
    "+ Save current settings as template": "＋ 將目前設定儲存為模板",
    "Template name": "模板名稱",
    "Saved template \"{0}\"": "已儲存模板「{0}」",
    "Icon": "圖示",
    "Icon name / emoji": "圖示名稱 / emoji",
    "Text color": "文字顏色",
    "Background color": "背景顏色",
    "Background opacity": "背景透明度",
    "100 = opaque; lower values are more transparent": "100 = 不透明；數值越小越透明",
    "Clear appearance": "清除外觀",
    "Properties": "屬性",
    "Name": "名稱",
    "Path": "路徑",
    "Type": "類型",
    "Extension": "副檔名",
    "Size": "大小",
    "Contents": "內容",
    "{0} files, {1} subfolders (including all levels)": "{0} 個檔案、{1} 個子資料夾（含所有子層）",
    "Created": "建立時間",
    "Last modified": "最後修改",
    "Selected": "已選取",
    "{0} items ({1} folders, {2} files)": "{0} 個項目（{1} 個資料夾、{2} 個檔案）",
    "Total size": "總大小",
    "Back": "上一頁",
    "Forward": "下一頁",
    "Up one level": "上一層",
    "\"Cross-level move\" is off; cannot move to another level": "「跨層級移動」已關閉，無法移到其他層級",
    "Path copied": "已複製路徑",
    "Copy failed": "複製失敗",
    "Copy path": "複製路徑",
    "Copy full path": "複製完整路徑",
    "Selection mode ({0} selected)": "選取模式（已選 {0}）",
    "Select all": "全選",
    "Done": "結束選取",
    "Temp · {0}": "臨時 · {0}",
    "Pin to top": "置頂",
    "Bookmarked": "已加入書籤",
    "{0} files": "{0} 檔",
    "{0} folders": "{0} 夾",
    "Open": "開啟",
    "Open to the right": "在右側開啟",
    "Open in new window": "在新視窗開啟",
    "Show in folder": "在資料夾中顯示",
    "Exit selection mode": "取消選取狀態",
    "Enter selection mode": "進入選取狀態",
    "Add to focus zone…": "加入專注區…",
    "Remove from focus zone ({0})": "從專注區移除（{0}）",
    "Create temporary folder": "創建臨時文件夾",
    "Move to temporary folder…": "移到臨時文件夾…",
    "Move out of temporary folder": "移出臨時文件夾",
    "Copy": "複製",
    "Cut": "剪下",
    "Paste": "貼上",
    "Remove bookmark": "移除書籤",
    "Add bookmark": "加入書籤",
    "Rename": "重新命名",
    "Batch rename… ({0})": "批量重新命名…（{0}）",
    "Batch rename files inside folder…": "批量重新命名資料夾內的檔案…",
    "This folder has no files": "此資料夾內沒有檔案",
    "Appearance (icon / color)…": "外觀（圖示／顏色）…",
    "Unpin": "取消置頂",
    "Move up": "往上",
    "Move down": "往下",
    "Move up one level": "移到上一層",
    "Move down one level (into the previous folder)": "移到下一層（放入上一個文件夾）",
    "Select all (visible)": "全選（可見項目）",
    "Select all (including collapsed)": "全選（含未展開）",
    "New note here": "在此新增筆記",
    "New folder here": "在此新增文件夾",
    "New {0} here": "在此新增 {0}",
    "Properties…": "屬性…",
    "Delete": "刪除",
    "Rename temporary folder": "重新命名臨時文件夾",
    "Delete temporary folder (shortcuts move back to top level)": "刪除臨時文件夾（捷徑移回頂層）",
    "New focus zone": "新增專注區",
    "Rename this focus zone": "重新命名此專注區",
    "Delete this focus zone": "刪除此專注區",
    "New note": "新增筆記",
    "New folder": "新增文件夾",
    "New {0}": "新增 {0}",
    "Paste to root": "貼上到根目錄",
    "Paste to current folder": "貼上到目前資料夾",
    "Focus File Manager": "專注文件管理器",
    "(This folder is empty)": "（此資料夾是空的）",
    "(The vault is empty)": "（庫是空的）",
    "Select files/folders on the left, then right-click \"Add to focus zone\"": "在左側選取文件／文件夾，右鍵「加入專注區」",
    "Right-click here to create a focus zone": "在此處按右鍵，新增一個專注區",
    "Reset manual order…": "重置手動排序…",
    "Reset the manual order? All manual ordering records will be cleared.": "確定要重置手動排序嗎？所有手動排序紀錄將被清除。",
    "Collapse all": "全部收合",
    "Expand all": "全部展開",
    "Refresh": "重新整理",
    "Refresh (manually refresh open-file markers)": "重新整理（手動刷新開啟標記）",
    "Show: {0}": "顯示：{0}",
    "Click to switch: File manager → Focus zone → Both (current: {0})": "點擊切換：文件管理 → 專注區 → 兩者（目前：{0}）",
    "On": "開",
    "Off": "關",
    "Cross-level move: {0}": "跨層級移動：{0}",
    "Cross-level move (limits dragging): {0}": "跨層級移動（限制拖曳）：{0}",
    "Default": "預設",
    "Manual": "手動",
    "Sort: {0}": "排序：{0}",
    "Sort order: {0}": "排序方式：{0}",
    "Collapse all (press again to switch to expand all)": "全部收合（再按一次切換為全部展開）",
    "Expand all (press again to switch to collapse all)": "全部展開（再按一次切換為全部收合）",
    "+": "＋",
    "Open Focus File Manager in sidebar": "在側邊欄開啟專注文件管理器",
    "Open Focus File Manager in main area": "在主區域開啟專注文件管理器",
    "Show file manager only": "只顯示文件管理",
    "Show focus zone only": "只顯示專注區",
    "Show both": "兩者同時顯示",
    "Cycle view (File manager → Focus zone → Both)": "切換顯示（文件管理 → 專注區 → 兩者）",
    "My indent guide style": "我的縮排線樣式",
    "Language file exported: ": "已導出語言檔案：",
    "Export failed: ": "導出失敗：",
    "No usable translations in the file": "檔案中沒有可用的翻譯",
    "Imported language \"{0}\" ({1} strings)": "已導入語言「{0}」（{1} 條翻譯）",
    "Import failed: ": "導入失敗：",
    "Removed language \"{0}\"": "已移除語言「{0}」",
    "Please enter a path first": "請先填寫路徑",
    "File not found: ": "找不到檔案：",
    "Indent guide style exported: ": "已導出縮排線樣式：",
    "Template reference exported: ": "已導出範本參考：",
    "Imported style {0}": "匯入的樣式 {0}",
    "No usable styles in the file": "檔案中沒有可用的樣式",
    "Imported and applied \"{0}\"": "已導入並套用「{0}」",
    "Imported {0} styles; choose one from \"Style template\"": "已導入 {0} 個樣式，請從「樣式範本」選用",
    "Open in new tab at the end": "在末尾新分頁開啟",
    "Open in new tab to the right": "在右側新分頁開啟",
    "Showing in folder is not supported on this platform": "此平台無法在資料夾中顯示",
    "Last modified: {0}\nCreated: {1}": "最後修改：{0}\n建立：{1}",
    "Manual order reset": "已重置手動排序",
    "Switched to manual order": "已切換為手動排序",
    "Cannot move a folder into itself": "無法將文件夾移到自己內部",
    "An item with the same name already exists at the destination: {0}": "目標已存在同名項目：{0}",
    "Move failed: ": "移動失敗：",
    "\"{0}\" is already at the top level": "「{0}」已在最上層",
    "No folder above \"{0}\" to move it into": "「{0}」上方沒有可放入的文件夾",
    "The name contains invalid characters": "名稱含有不合法字元",
    "Delete {0} items? (moved to trash per Obsidian settings)": "確定刪除 {0} 個項目？（依 Obsidian 設定移到垃圾桶）",
    "Delete failed: ": "刪除失敗：",
    "Canvas": "畫布",
    "Excalidraw plugin not found; make sure it is enabled": "找不到 Excalidraw 插件，請確認已啟用",
    "Failed to create Excalidraw: ": "建立 Excalidraw 失敗：",
    "Create failed: ": "建立失敗：",
    "The Obsidian core plugin \"Bookmarks\" is not enabled": "尚未啟用 Obsidian 核心外掛「書籤」",
    "Bookmark operation failed: ": "書籤操作失敗：",
    "\"Cross-level move\" is off; cannot drop into another folder": "「跨層級移動」已關閉，無法拖進其他文件夾",
    "\"Cross-level move\" is off; you can only reorder within the same level": "「跨層級移動」已關閉，只能在同一層級內排序",
    "Only top-level items can be removed from a focus zone": "只能從專注區移除頂層項目",
    "Removed {0} items from the focus zone": "已從專注區移除 {0} 個項目",
    "Cut {0} items": "已剪下 {0} 個項目",
    "Copied {0} items": "已複製 {0} 個項目",
    "Paste failed: ": "貼上失敗：",
    "Pasted {0} items": "已貼上 {0} 個項目",
    "No files or folders on the clipboard to paste": "剪貼簿中沒有可貼上的檔案或文件夾",
    "Copied {0} paths": "已複製 {0} 個路徑",
    "Folder not found": "找不到該資料夾",
    "Please create a focus zone first": "請先新增專注區",
    "Delete temporary folder \"{0}\"? Its shortcuts will move back to the top level of the focus zone (real files are not deleted).": "確定刪除臨時文件夾「{0}」？裡面的捷徑會移回專注區頂層（不會刪除實際檔案）。",
    "Only shortcuts inside a focus zone can be moved": "只能移動專注區裡的捷徑",
    "Rename focus zone": "重新命名專注區",
    "Delete focus zone \"{0}\"? (real files are not deleted)": "確定刪除專注區「{0}」？（不會刪除實際檔案）",
    "Move left": "左移",
    "Move right": "右移",
    "Delete focus zone": "刪除專注區",
    "Added to \"{0}\"{1}": "已加入「{0}」{1}",
    "Language": "語言",
    "Interface language": "介面語言",
    "Follows the system (Obsidian) language by default; English is used if the language is not available. Japanese and Simplified Chinese are machine translations and may be inaccurate. Command names update after reloading the plugin.": "預設跟隨系統（Obsidian）語言；找不到對應語言時使用英文。日文與簡體中文為機器翻譯，可能不準確。指令名稱需重新載入插件後才會更新。",
    "Follow system": "跟隨系統",
    "Language file path": "語言檔案路徑",
    "Relative path = a file in the vault; on desktop you can also enter a full path. The exported JSON uses English as the default template: edit the translations inside \"strings\", then import it. Imported languages are listed by file name after the built-in languages.": "相對路徑 = 庫內檔案；桌面版也可填完整路徑。導出的 JSON 以英文為預設範本：修改 strings 裡的翻譯後再導入即可。導入的語言會以檔名顯示在內建語言後面",
    "Export / import language": "導出／導入語言",
    "Export English template": "導出英文範本",
    "Export current language": "導出目前語言",
    "Import": "導入",
    "Manage imported languages": "管理導入的語言",
    "Remove": "移除",
    "Behavior": "操作",
    "File manager style": "文件管理樣式",
    "Default: tree (expandable subfolders). Explorer: path bar on top, one level at a time, click a folder to enter it (focus zones are unaffected)": "預設：樹狀（可展開子資料夾）。電腦式：上方顯示路徑，一次只顯示一層，點資料夾進入下一層（專注區不受影響）",
    "Default (tree)": "預設（樹狀）",
    "Explorer (level by level)": "電腦式（逐層進入）",
    "Sort order": "排序方式",
    "You can also switch with the sort button on the toolbar. For time-based sorting, a folder uses the time of the newest (modified) or oldest (created) file inside it": "也可以用工具列的排序按鈕切換。時間排序時，資料夾以其內容中最新（編輯）或最舊（創建）的檔案時間為準",
    "Folders before files when sorting": "排序時資料夾排在檔案前面",
    "On by default (same as Obsidian)": "預設開啟（與 Obsidian 相同）",
    "Exclude items from \"Expand all / Collapse all\"": "「全部展開／全部收合」排除指定項目",
    "When enabled, folders matching the list below are not affected by Expand all or Collapse all and keep their current state": "啟用後，符合下方清單的資料夾不會被全部展開或全部收合影響，保持原本的展開狀態",
    "Exclusion list": "排除清單",
    "One per line. A name only (e.g. Attachments) = any folder with that name; a path (e.g. Projects/Archive) = the folder at that path. Wildcards * and ? are supported": "每行一個。只填名稱（例如 Attachments）＝任何位置的同名資料夾；填路徑（例如 Projects/Archive）＝該路徑的資料夾。可使用 * 與 ? 萬用字元",
    "Top view-mode button style": "頂部顯示選項按鈕樣式",
    "\"File manager / Focus zone / Both\": separate buttons, or one merged icon button that cycles": "「文件管理／專注區／兩者」：獨立按鈕，或合併為一個循環切換的圖示按鈕",
    "Separate buttons": "獨立按鈕",
    "Cycle button (merged)": "循環按鈕（合併）",
    "Top button appearance": "頂部按鈕外觀",
    "Use icons like Obsidian's built-in file explorer (description shown on hover), icons with text, or plain text": "像 Obsidian 內建檔案管理器那樣用圖示（滑鼠移上去顯示描述），或圖示搭配文字描述，或純文字",
    "Text buttons": "純文字按鈕",
    "Icon buttons (description as tooltip)": "圖示按鈕（描述顯示為滑鼠提示）",
    "Icon + text label": "圖示 + 文字描述",
    "Merge \"Collapse all / Expand all\" into one button": "「全部收合／全部展開」合併為一個按鈕",
    "Like the built-in file explorer: the button reads \"Collapse all\" when something is expanded, otherwise \"Expand all\"": "像內建檔案管理器：目前有展開的項目時按鈕為「全部收合」，否則為「全部展開」",
    "Clicking a folder does not expand/collapse": "點擊資料夾不展開／收合",
    "When enabled, only the arrow beside a folder expands or collapses it": "啟用後，只有點資料夾旁邊的箭頭符號才會展開或收合",
    "Single click does not open files": "單擊文件不開啟",
    "When enabled, a single click only selects; an open icon appears beside files, and you click it to open": "啟用後，單擊只會選取；文件旁邊會出現開啟符號，點它才開啟",
    "How files open": "開啟文件的方式",
    "Applies to single-click open, the right-click \"Open\" and the open icon": "套用於單擊開啟、右鍵「開啟」與開啟符號",
    "Open in current tab": "在目前分頁開啟",
    "Open in new tab": "在新分頁開啟",
    "Show an \"open in new tab\" icon beside the open icon": "開啟符號旁顯示「新分頁開啟」符號",
    "Only shown when the previous option is \"Open in current tab\"": "僅在上一項為「在目前分頁開啟」時顯示",
    "Open icon color": "開啟符號顏色",
    "Open icon opacity": "開啟符號透明度",
    "\"Open in new tab\" icon color": "「新分頁開啟」符號顏色",
    "\"Open in new tab\" icon opacity": "「新分頁開啟」符號透明度",
    "Leave empty for the default color. Accepts color names, RGB or HEX": "留空 = 預設顏色。可填顏色名稱、RGB、HEX",
    "Default color": "預設顏色",
    "Reset": "重置",
    "100% = opaque": "100% = 不透明",
    "New tab position": "新分頁開啟的位置",
    "Used by the right-click \"Open in new tab to the right\" and the new-tab icon": "右鍵「在右側新分頁開啟」與新分頁符號使用",
    "Next to the current tab (default)": "在目前分頁旁邊開啟（預設）",
    "At the end of the tabs": "在分頁末尾開啟",
    "Show times on hover": "滑鼠停留時顯示時間",
    "Hover over a file or folder to see its last modified and created times (also available via right-click \"Properties\")": "停留在檔案或資料夾上，顯示最後修改時間與建立時間（也可右鍵「屬性」查看）",
    "Dim other levels while dragging when cross-level move is off": "跨層級移動關閉時，拖曳讓其他層級變灰",
    "While dragging, items not on the same level are dimmed": "拖曳項目時，不屬於同一層級的項目會變灰",
    "Dim level": "變灰程度",
    "The value is the visibility (%) of other-level items; lower is dimmer": "數值是其他層級項目的可見度（%），越小越灰",
    "Double-click interval (ms)": "雙擊判定時間（毫秒）",
    "Two clicks closer than this count as a double-click (rename). When the previous option is off, opening a file by single click is delayed by this long": "兩次點擊間隔小於此值視為雙擊（重新命名）。未啟用上一項時，單擊開啟文件會延遲這麼久",
    "Folder scope when dragging into a focus zone": "拖曳到專注區時的文件夾範圍",
    "Include all sublevels": "包含所有子層",
    "Displayed info": "顯示資訊",
    "Folders: show file count": "文件夾：顯示檔案數量",
    "Folders: show subfolder count": "文件夾：顯示子文件夾數量",
    "Counts include all sublevels (recursive)": "數量包含所有子層（遞迴）",
    "When off, only the current level is counted": "關閉時只計算當前層級",
    "Extensions counted as files": "計入檔案數量的副檔名",
    "Comma-separated, e.g. md,png,pdf; use * for all": "以逗號分隔，例如 md,png,pdf；填 * 代表全部",
    "Files: show extension": "檔案：顯示副檔名",
    "Files: show created time": "檔案：顯示創建時間",
    "Files: show size": "檔案：顯示大小",
    "File info position": "檔案資訊顯示位置",
    "Where the extension, created time, size and folder counts are placed": "副檔名、創建時間、大小、文件夾數量的擺放方式",
    "All after the file name": "全部顯示在檔案名稱後面",
    "All below the file name (.md date size)": "全部顯示在檔案名稱下方（.md 日期 大小）",
    "Extension after the name; created time and size below": "副檔名在名稱後面，創建時間與大小在下方",
    "Size format": "大小顯示方式",
    "Default: automatic unit (B / KB / MB…). Custom: choose the unit, decimals and base": "預設：自動選擇單位（B／KB／MB…）。自訂：指定單位、小數位數與進位基數",
    "Custom": "自訂",
    "Unit": "單位",
    "Auto": "自動",
    "Decimal places": "小數位數",
    "Base": "進位基數",
    "1024 (KiB style)": "1024（KiB 式）",
    "1000 (SI style)": "1000（SI 式）",
    "Show full folder names": "資料夾顯示完整名稱",
    "When off, names that don't fit are truncated with \"…\" (off by default)": "關閉時，空間不足的名稱會以「…」截斷（預設關閉）",
    "Show full file names": "檔案顯示完整名稱",
    "Wrap full names to the sidebar width": "完整名稱依側邊欄寬度自動換行",
    "On (default): names wrap to the available width. Off: names stay on one line and can be scrolled sideways. Only applies when the two options above are on": "開啟（預設）：名稱依寬度自動換行。關閉：名稱保持單行，過長時可左右捲動。僅在上面兩項開啟時有作用",
    "Appearance & theme compatibility": "外觀與主題相容",
    "The list uses Obsidian's native style classes and the data-path attribute, so themes and CSS snippets usually apply directly. You can replace the symbols below; icons accept Lucide icon names, icon IDs registered by other plugins, or emoji/text. Set per-item icons and colors via right-click \"Appearance\".": "列表使用 Obsidian 原生的樣式類別與 data-path 屬性，主題與 CSS 片段通常能直接套用。下方可替換各種符號；圖示可填 Lucide 圖示名稱、其他插件註冊的圖示 ID，或 emoji／文字。個別項目的圖示與顏色請在右鍵「外觀」設定。",
    "Use Obsidian's native style classes": "使用 Obsidian 原生樣式類別",
    "Compatible with themes and CSS snippets; turn off if the layout looks wrong": "相容主題與 CSS 片段；若版面異常可關閉",
    "Show indent guides": "顯示縮排線",
    "Show a line to the left of child items when a folder is expanded (on by default)": "展開資料夾時，子項目左側顯示一條線（預設開啟）",
    "Indent guide color": "縮排線顏色",
    "Leave empty to follow the theme. Accepts color names, RGB or HEX": "留空 = 跟隨主題。可填顏色名稱、RGB、HEX",
    "Follow theme": "跟隨主題",
    "Reset (follow theme)": "重置（跟隨主題）",
    "Indent guide opacity": "縮排線透明度",
    "Indent guide thickness (px)": "縮排線粗細（px）",
    "Indent guide style template": "縮排線樣式範本",
    "Choosing a template overwrites the line style, color, opacity, thickness, indent distance and advanced CSS below": "選擇範本會覆蓋下方的線型、顏色、透明度、粗細、縮排距離與進階 CSS",
    "(Choose a template…)": "（選擇範本…）",
    "Template: {0}": "範本：{0}",
    "Custom: {0}": "自訂：{0}",
    "Indent guide line style": "縮排線線型",
    "Indent distance (px)": "縮排距離（px）",
    "How far each level of children is indented to the right": "每一層子項目向右縮進的距離",
    "Advanced: custom CSS declarations": "進階：自訂 CSS 宣告",
    "Only property declarations are accepted (e.g. box-shadow: …;). Use var(--ffm-guide-final) to get the final color after color and opacity are applied. For safety, url(), @-rules and braces are not allowed": "只接受屬性宣告（例如 box-shadow: …;），可使用 var(--ffm-guide-final) 取得套用顏色與透明度後的最終色。出於安全，不允許 url()、@規則與大括號",
    "Style name": "樣式名稱",
    "Written to the file on export; after import it also appears in the template list under this name": "導出時寫入檔案，導入後也會以此名稱出現在範本清單",
    "Export / import path": "導出／導入路徑",
    "Relative path = a file in the vault; on desktop you can also enter a full path (e.g. D:\\\\styles\\\\guide.json). Folders are created automatically on export": "相對路徑 = 庫內的檔案；桌面版也可填完整路徑（例如 D:\\styles\\guide.json）。導出時會自動建立資料夾",
    "Export / import": "導出／導入",
    "\"Export template reference\" writes guide-style-templates.json to the same folder, containing all built-in templates, as a reference for custom styles": "「導出範本參考」會在同一個資料夾寫出 guide-style-templates.json，內含所有內建範本，可當作自訂樣式的參考檔",
    "Export current style": "導出目前樣式",
    "Export template reference": "導出範本參考",
    "Manage imported styles": "管理導入的樣式",
    "Display text size": "顯示文字大小",
    "Default: follow Obsidian. Custom: set the list text size (px)": "預設：跟隨 Obsidian。自訂：指定列表文字大小（px）",
    "Follow Obsidian (default)": "跟隨 Obsidian（預設）",
    "Text size (px)": "文字大小（px）",
    "Pin icon": "置頂符號",
    "Shown beside pinned items": "置頂的項目旁顯示",
    "Show bookmark marks": "顯示書籤標記",
    "Synced with Obsidian bookmarks; bookmarked items get a mark beside them": "與 Obsidian 書籤連動，已加入書籤的項目旁顯示標記",
    "Bookmark icon": "書籤符號",
    "Other file types for right-click \"New\"": "右鍵「新增」的其他檔案類型",
    "Base and Canvas are built in; Excalidraw also appears if the plugin is enabled. Other types: one per line in the format Name|extension|initial content (\\n = line break)": "Base、畫布已內建；若已啟用 Excalidraw 插件也會出現。其他類型每行一個，格式：名稱|副檔名|初始內容（\\n 代表換行）",
    "Show icons beside folders": "顯示資料夾旁的圖示",
    "On by default": "預設開啟",
    "Show icons beside files": "顯示檔案旁的圖示",
    "Icon source": "圖示來源",
    "Some themes (e.g. Rathgar Gold) draw their own folder and file icons. Auto: use the theme's icons when detected to avoid duplicates; you can also force the theme's or the plugin's icons": "有些主題（例如 Rathgar Gold）會自己畫資料夾與檔案圖示。自動：偵測到主題有畫就用主題的，避免重複；也可強制使用主題或插件的圖示",
    "Auto (detect theme)": "自動（偵測主題）",
    "Use theme icons": "使用主題圖示",
    "Use plugin icons (customizable below)": "使用插件圖示（下方可自訂）",
    "Expand / collapse arrow": "展開／收合符號",
    "Auto: if the theme hides the expand arrow, it is hidden too (you can still click the folder row to expand); always shown when \"Clicking a folder does not expand/collapse\" is on": "自動：主題若隱藏了展開符號就跟著隱藏（仍可點資料夾列展開）；若已開啟「點擊資料夾不展開」則一定顯示",
    "Auto (follow theme)": "自動（跟隨主題）",
    "Always show": "一律顯示",
    "Always hide": "一律隱藏",
    "Collapsed arrow": "收合狀態的符號",
    "Expanded arrow": "展開狀態的符號",
    "Folder icon": "資料夾圖示",
    "Folder icon (expanded)": "資料夾圖示（展開時）",
    "File icon": "檔案圖示",
    "File icons by extension": "依副檔名指定檔案圖示",
    "One per line, format: extension=icon. E.g. md=file-text, png=image, pdf=📕": "每行一個，格式：副檔名=圖示。例如 md=file-text、png=image、pdf=📕",
    "Restore default icons": "還原預設圖示",
    "Hotkeys": "快捷鍵",
    "View-mode hotkeys": "顯示模式快捷鍵",
    "All empty by default. You can assign hotkeys to the four commands \"Show file manager only\", \"Show focus zone only\", \"Show both\" and \"Cycle view\".": "預設皆為空白。可分別為「只顯示文件管理」「只顯示專注區」「兩者同時顯示」「循環切換」四個指令設定快捷鍵。",
    "Open hotkey settings": "開啟快捷鍵設定",
    "Go to \"Settings → Hotkeys\" and search for \"Focus File Manager\"": "請到「設定 → 快捷鍵」搜尋「Focus File Manager」",
    "Open-file markers": "開啟標記",
    "Symbol / icon name / emoji": "符號 / 圖示名稱 / emoji",
    "Reset symbol": "重置符號",
    "Color": "顏色",
    "Reset color": "重置顏色",
    "Currently displayed file": "目前顯示中的文件",
    "A file whose tab is in the foreground and visible on screen (default: dot). The first box takes a symbol, Lucide icon name or emoji (pick an icon with the button on the right); the second takes a color (red, 255,0,0 and #FF0000 all work)": "分頁在前景、畫面上看得到的文件（預設圓點）。第一格填符號、Lucide 圖示名稱或 emoji（右側可選圖示），第二格填顏色（紅色、red、255,0,0、#FF0000 都可以）",
    "Open file (background tab)": "已開啟（背景分頁）的文件",
    "A file that is open but whose tab is in the background (not currently shown) (default: square)": "已經開啟、但分頁在背景（目前沒顯示）的文件（預設方點）",
    "Custom color names": "自訂顏色名稱",
    "One per line, format: name=color. E.g. \"vermilion=#ff4500\" or \"crimson=red\"": "每行一個，格式：名稱=顏色。例如「朱紅=#ff4500」或「紅=red」",
    "Batch rename presets": "批量重新命名方案",
    "Preset name": "方案名稱",
    "Untitled": "未命名",
    "Name pattern / numbering": "名稱格式 / 編號",
    "Delete this preset": "刪除此方案",
    "Keep at least one preset": "至少要保留一個方案",
    "{n} number, {name} original name, {ext} extension, {i} order": "{n} 序號、{name} 原名稱、{ext} 副檔名、{i} 順序",
    "Add preset": "新增方案",
    "New preset": "新方案"
  },
  "zh-CN": {
    "Numbering (100, 200…)": "编号（100、200…）",
    "Replace characters": "替换字符",
    "File manager": "文件管理",
    "Focus zone": "专注区",
    "Both": "两者",
    "Default (Obsidian)": "默认（Obsidian）",
    "Manual order": "手动排序",
    "Name A → Z": "名称 A → Z",
    "Name Z → A": "名称 Z → A",
    "Modified: newest first": "编辑时间 新 → 旧",
    "Modified: oldest first": "编辑时间 旧 → 新",
    "Created: newest first": "创建时间 新 → 旧",
    "Created: oldest first": "创建时间 旧 → 新",
    "Solid": "实线",
    "Dashed": "虚线",
    "Dotted": "点线",
    "Double": "双线",
    "Default (follow theme)": "默认（跟随主题）",
    "Solid line; color and thickness follow the theme": "实线，颜色与粗细跟随主题",
    "Light solid": "淡实线",
    "Thin semi-transparent solid line": "半透明的细实线",
    "Thin dashed line": "细虚线",
    "Round-dot line": "圆点线",
    "Double-layer line": "双层线",
    "Thick solid": "粗实线",
    "Bold, eye-catching line": "醒目的粗线",
    "Compact": "紧凑",
    "Smaller indentation, good for narrow sidebars": "缩进距离较小，适合窄侧边栏",
    "Gradient fade": "渐变淡出",
    "Fades from top to bottom": "由上到下逐渐变淡",
    "Glow": "发光",
    "Soft glow around the line": "线条外围带柔光",
    "Rounded thick bar": "圆角粗条",
    "Thick line with rounded ends": "两端带圆角的粗线",
    "Imported style": "导入的样式",
    "Common": "常用",
    "Files": "文件",
    "Folders": "文件夹",
    "Arrows": "箭头",
    "Marks": "标记",
    "Tools": "工具",
    "Life": "生活",
    "Fantasy": "奇幻",
    "Nature": "自然",
    "Search icon name (English)…": "搜寻图标名称（英文）…",
    "{0} in total": "共 {0} 个",
    "No matching icons": "找不到符合的图标",
    "All": "全部",
    "OK": "确定",
    "Please confirm": "请确认",
    "Cancel": "取消",
    "Add to focus zone": "加入专注区",
    "+ New focus zone…": "＋ 新增专注区…",
    "New focus zone name": "新专注区名称",
    "Folder scope": "文件夹范围",
    "Include all files and subfolders": "包含此文件夹下所有文件与子文件夹",
    "Current level files only": "只包含当前层级的文件",
    "Add": "加入",
    "Please enter a focus zone name": "请输入专注区名称",
    "Preset": "方案",
    "Add or edit presets in the plugin settings": "可在插件设置中新增、编辑方案",
    "Apply": "应用",
    "Batch rename ({0} items)": "批量重命名（{0} 个项目）",
    "Name pattern": "名称格式",
    "Available: {n} number, {name} original name (without extension), {ext} extension, {i} order (1,2,3…)": "可用：{n} 序号、{name} 原名称（不含扩展名）、{ext} 扩展名、{i} 顺序(1,2,3…)",
    "Start number": "起始数字",
    "Step": "递增",
    "Zero-padding digits": "补零位数",
    "0 means no padding": "0 代表不补零",
    "Find": "查找",
    "Replace with": "替换为",
    "Use regular expression": "使用正则表达式",
    "Case sensitive": "区分大小写",
    "Invalid name": "名称不合法",
    "Duplicate name": "名称重复",
    "An item with the same name already exists": "已存在同名项目",
    "\"{0}\" → \"{1}\": {2}": "「{0}」→「{1}」：{2}",
    "No items to rename": "没有要重命名的项目",
    "Remove from this batch rename": "从这次批量重命名中移除",
    "Renamed {0} items": "已重命名 {0} 个项目",
    "Rename failed: ": "重命名失败：",
    "Choose icon": "选择图标",
    "Appearance ({0} items)": "外观设置（{0} 个项目）",
    "Click an icon or template below to apply it immediately. You can also type a Lucide name, an icon ID registered by another plugin, or an emoji. Colors accept names (red), RGB (255,0,0) or HEX (#FF0000).": "点下方图标或模板会立即应用。图标也可手动输入 Lucide 名称、其他插件注册的图标 ID 或 emoji。颜色可填名称（红色、red）、RGB（255,0,0）或 HEX（#FF0000）。",
    "My templates": "我的模板",
    "(No templates saved yet)": "（尚未保存任何模板）",
    "Click to apply this template": "点击应用此模板",
    "Delete this template": "删除此模板",
    "+ Save current settings as template": "＋ 将当前设置保存为模板",
    "Template name": "模板名称",
    "Saved template \"{0}\"": "已保存模板「{0}」",
    "Icon": "图标",
    "Icon name / emoji": "图标名称 / emoji",
    "Text color": "文字颜色",
    "Background color": "背景颜色",
    "Background opacity": "背景透明度",
    "100 = opaque; lower values are more transparent": "100 = 不透明；数值越小越透明",
    "Clear appearance": "清除外观",
    "Properties": "属性",
    "Name": "名称",
    "Path": "路径",
    "Type": "类型",
    "Extension": "扩展名",
    "Size": "大小",
    "Contents": "内容",
    "{0} files, {1} subfolders (including all levels)": "{0} 个文件、{1} 个子文件夹（含所有子层）",
    "Created": "创建时间",
    "Last modified": "最后修改",
    "Selected": "已选取",
    "{0} items ({1} folders, {2} files)": "{0} 个项目（{1} 个文件夹、{2} 个文件）",
    "Total size": "总大小",
    "Back": "上一页",
    "Forward": "下一页",
    "Up one level": "上一层",
    "\"Cross-level move\" is off; cannot move to another level": "「跨层级移动」已关闭，无法移到其他层级",
    "Path copied": "已复制路径",
    "Copy failed": "复制失败",
    "Copy path": "复制路径",
    "Copy full path": "复制完整路径",
    "Selection mode ({0} selected)": "选取模式（已选 {0}）",
    "Select all": "全选",
    "Done": "结束选取",
    "Temp · {0}": "临时 · {0}",
    "Pin to top": "置顶",
    "Bookmarked": "已加入书签",
    "{0} files": "{0} 个文件",
    "{0} folders": "{0} 个文件夹",
    "Open": "打开",
    "Open to the right": "在右侧打开",
    "Open in new window": "在新窗口打开",
    "Show in folder": "在文件夹中显示",
    "Exit selection mode": "取消选取状态",
    "Enter selection mode": "进入选取状态",
    "Add to focus zone…": "加入专注区…",
    "Remove from focus zone ({0})": "从专注区移除（{0}）",
    "Create temporary folder": "创建临时文件夹",
    "Move to temporary folder…": "移到临时文件夹…",
    "Move out of temporary folder": "移出临时文件夹",
    "Copy": "复制",
    "Cut": "剪切",
    "Paste": "粘贴",
    "Remove bookmark": "移除书签",
    "Add bookmark": "加入书签",
    "Rename": "重命名",
    "Batch rename… ({0})": "批量重命名…（{0}）",
    "Batch rename files inside folder…": "批量重命名文件夹内的文件…",
    "This folder has no files": "此文件夹内没有文件",
    "Appearance (icon / color)…": "外观（图标／颜色）…",
    "Unpin": "取消置顶",
    "Move up": "往上",
    "Move down": "往下",
    "Move up one level": "移到上一层",
    "Move down one level (into the previous folder)": "移到下一层（放入上一个文件夹）",
    "Select all (visible)": "全选（可见项目）",
    "Select all (including collapsed)": "全选（含未展开）",
    "New note here": "在此新增笔记",
    "New folder here": "在此新增文件夹",
    "New {0} here": "在此新增 {0}",
    "Properties…": "属性…",
    "Delete": "删除",
    "Rename temporary folder": "重命名临时文件夹",
    "Delete temporary folder (shortcuts move back to top level)": "删除临时文件夹（快捷方式移回顶层）",
    "New focus zone": "新增专注区",
    "Rename this focus zone": "重命名此专注区",
    "Delete this focus zone": "删除此专注区",
    "New note": "新增笔记",
    "New folder": "新增文件夹",
    "New {0}": "新增 {0}",
    "Paste to root": "粘贴到根目录",
    "Paste to current folder": "粘贴到当前文件夹",
    "Focus File Manager": "专注文件管理器",
    "(This folder is empty)": "（此文件夹是空的）",
    "(The vault is empty)": "（库是空的）",
    "Select files/folders on the left, then right-click \"Add to focus zone\"": "在左侧选取文件／文件夹，右键「加入专注区」",
    "Right-click here to create a focus zone": "在此处按右键，新增一个专注区",
    "Reset manual order…": "重置手动排序…",
    "Reset the manual order? All manual ordering records will be cleared.": "确定要重置手动排序吗？所有手动排序纪录将被清除。",
    "Collapse all": "全部折叠",
    "Expand all": "全部展开",
    "Refresh": "刷新",
    "Refresh (manually refresh open-file markers)": "刷新（手动刷新打开标记）",
    "Show: {0}": "显示：{0}",
    "Click to switch: File manager → Focus zone → Both (current: {0})": "点击切换：文件管理 → 专注区 → 两者（当前：{0}）",
    "On": "开",
    "Off": "关",
    "Cross-level move: {0}": "跨层级移动：{0}",
    "Cross-level move (limits dragging): {0}": "跨层级移动（限制拖动）：{0}",
    "Default": "默认",
    "Manual": "手动",
    "Sort: {0}": "排序：{0}",
    "Sort order: {0}": "排序方式：{0}",
    "Collapse all (press again to switch to expand all)": "全部折叠（再按一次切换为全部展开）",
    "Expand all (press again to switch to collapse all)": "全部展开（再按一次切换为全部折叠）",
    "+": "＋",
    "Open Focus File Manager in sidebar": "在侧边栏打开专注文件管理器",
    "Open Focus File Manager in main area": "在主区域打开专注文件管理器",
    "Show file manager only": "只显示文件管理",
    "Show focus zone only": "只显示专注区",
    "Show both": "两者同时显示",
    "Cycle view (File manager → Focus zone → Both)": "切换显示（文件管理 → 专注区 → 两者）",
    "My indent guide style": "我的缩进线样式",
    "Language file exported: ": "已导出语言文件：",
    "Export failed: ": "导出失败：",
    "No usable translations in the file": "文件中没有可用的翻译",
    "Imported language \"{0}\" ({1} strings)": "已导入语言「{0}」（{1} 条翻译）",
    "Import failed: ": "导入失败：",
    "Removed language \"{0}\"": "已移除语言「{0}」",
    "Please enter a path first": "请先填写路径",
    "File not found: ": "找不到文件：",
    "Indent guide style exported: ": "已导出缩进线样式：",
    "Template reference exported: ": "已导出模板参考：",
    "Imported style {0}": "导入的样式 {0}",
    "No usable styles in the file": "文件中没有可用的样式",
    "Imported and applied \"{0}\"": "已导入并应用「{0}」",
    "Imported {0} styles; choose one from \"Style template\"": "已导入 {0} 个样式，请从「样式模板」选用",
    "Open in new tab at the end": "在末尾新标签页打开",
    "Open in new tab to the right": "在右侧新标签页打开",
    "Showing in folder is not supported on this platform": "此平台无法在文件夹中显示",
    "Last modified: {0}\nCreated: {1}": "最后修改：{0}\n创建：{1}",
    "Manual order reset": "已重置手动排序",
    "Switched to manual order": "已切换为手动排序",
    "Cannot move a folder into itself": "无法将文件夹移到自己内部",
    "An item with the same name already exists at the destination: {0}": "目标已存在同名项目：{0}",
    "Move failed: ": "移动失败：",
    "\"{0}\" is already at the top level": "「{0}」已在最上层",
    "No folder above \"{0}\" to move it into": "「{0}」上方没有可放入的文件夹",
    "The name contains invalid characters": "名称含有不合法字元",
    "Delete {0} items? (moved to trash per Obsidian settings)": "确定删除 {0} 个项目？（依 Obsidian 设置移到回收站）",
    "Delete failed: ": "删除失败：",
    "Canvas": "画布",
    "Excalidraw plugin not found; make sure it is enabled": "找不到 Excalidraw 插件，请确认已启用",
    "Failed to create Excalidraw: ": "创建 Excalidraw 失败：",
    "Create failed: ": "创建失败：",
    "The Obsidian core plugin \"Bookmarks\" is not enabled": "尚未启用 Obsidian 核心插件「书签」",
    "Bookmark operation failed: ": "书签操作失败：",
    "\"Cross-level move\" is off; cannot drop into another folder": "「跨层级移动」已关闭，无法拖进其他文件夹",
    "\"Cross-level move\" is off; you can only reorder within the same level": "「跨层级移动」已关闭，只能在同一层级内排序",
    "Only top-level items can be removed from a focus zone": "只能从专注区移除顶层项目",
    "Removed {0} items from the focus zone": "已从专注区移除 {0} 个项目",
    "Cut {0} items": "已剪切 {0} 个项目",
    "Copied {0} items": "已复制 {0} 个项目",
    "Paste failed: ": "粘贴失败：",
    "Pasted {0} items": "已粘贴 {0} 个项目",
    "No files or folders on the clipboard to paste": "剪贴板中没有可粘贴的文件或文件夹",
    "Copied {0} paths": "已复制 {0} 个路径",
    "Folder not found": "找不到该文件夹",
    "Please create a focus zone first": "请先新增专注区",
    "Delete temporary folder \"{0}\"? Its shortcuts will move back to the top level of the focus zone (real files are not deleted).": "确定删除临时文件夹「{0}」？里面的快捷方式会移回专注区顶层（不会删除实际文件）。",
    "Only shortcuts inside a focus zone can be moved": "只能移动专注区里的快捷方式",
    "Rename focus zone": "重命名专注区",
    "Delete focus zone \"{0}\"? (real files are not deleted)": "确定删除专注区「{0}」？（不会删除实际文件）",
    "Move left": "左移",
    "Move right": "右移",
    "Delete focus zone": "删除专注区",
    "Added to \"{0}\"{1}": "已加入「{0}」{1}",
    "Language": "语言",
    "Interface language": "界面语言",
    "Follows the system (Obsidian) language by default; English is used if the language is not available. Japanese and Simplified Chinese are machine translations and may be inaccurate. Command names update after reloading the plugin.": "默认跟随系统（Obsidian）语言；找不到对应语言时使用英文。日文与简体中文为机器翻译，可能不准确。指令名称需重新加载插件后才会更新。",
    "Follow system": "跟随系统",
    "Language file path": "语言文件路径",
    "Relative path = a file in the vault; on desktop you can also enter a full path. The exported JSON uses English as the default template: edit the translations inside \"strings\", then import it. Imported languages are listed by file name after the built-in languages.": "相对路径 = 库内文件；桌面版也可填完整路径。导出的 JSON 以英文为默认模板：修改 strings 里的翻译后再导入即可。导入的语言会以文件名显示在内置语言后面",
    "Export / import language": "导出／导入语言",
    "Export English template": "导出英文模板",
    "Export current language": "导出当前语言",
    "Import": "导入",
    "Manage imported languages": "管理导入的语言",
    "Remove": "移除",
    "Behavior": "操作",
    "File manager style": "文件管理样式",
    "Default: tree (expandable subfolders). Explorer: path bar on top, one level at a time, click a folder to enter it (focus zones are unaffected)": "默认：树状（可展开子文件夹）。电脑式：上方显示路径，一次只显示一层，点文件夹进入下一层（专注区不受影响）",
    "Default (tree)": "默认（树状）",
    "Explorer (level by level)": "电脑式（逐层进入）",
    "Sort order": "排序方式",
    "You can also switch with the sort button on the toolbar. For time-based sorting, a folder uses the time of the newest (modified) or oldest (created) file inside it": "也可以用工具列的排序按钮切换。时间排序时，文件夹以其内容中最新（编辑）或最旧（创建）的文件时间为准",
    "Folders before files when sorting": "排序时文件夹排在文件前面",
    "On by default (same as Obsidian)": "默认打开（与 Obsidian 相同）",
    "Exclude items from \"Expand all / Collapse all\"": "「全部展开／全部折叠」排除指定项目",
    "When enabled, folders matching the list below are not affected by Expand all or Collapse all and keep their current state": "启用后，符合下方列表的文件夹不会被全部展开或全部折叠影响，保持原本的展开状态",
    "Exclusion list": "排除列表",
    "One per line. A name only (e.g. Attachments) = any folder with that name; a path (e.g. Projects/Archive) = the folder at that path. Wildcards * and ? are supported": "每行一个。只填名称（例如 Attachments）＝任何位置的同名文件夹；填路径（例如 Projects/Archive）＝该路径的文件夹。可使用 * 与 ? 万用字元",
    "Top view-mode button style": "顶部显示选项按钮样式",
    "\"File manager / Focus zone / Both\": separate buttons, or one merged icon button that cycles": "「文件管理／专注区／两者」：独立按钮，或合并为一个循环切换的图标按钮",
    "Separate buttons": "独立按钮",
    "Cycle button (merged)": "循环按钮（合并）",
    "Top button appearance": "顶部按钮外观",
    "Use icons like Obsidian's built-in file explorer (description shown on hover), icons with text, or plain text": "像 Obsidian 内置文件管理器那样用图标（鼠标移上去显示描述），或图标搭配文字描述，或纯文字",
    "Text buttons": "纯文字按钮",
    "Icon buttons (description as tooltip)": "图标按钮（描述显示为鼠标提示）",
    "Icon + text label": "图标 + 文字描述",
    "Merge \"Collapse all / Expand all\" into one button": "「全部折叠／全部展开」合并为一个按钮",
    "Like the built-in file explorer: the button reads \"Collapse all\" when something is expanded, otherwise \"Expand all\"": "像内置文件管理器：当前有展开的项目时按钮为「全部折叠」，否则为「全部展开」",
    "Clicking a folder does not expand/collapse": "点击文件夹不展开／折叠",
    "When enabled, only the arrow beside a folder expands or collapses it": "启用后，只有点文件夹旁边的箭头符号才会展开或折叠",
    "Single click does not open files": "单击文件不打开",
    "When enabled, a single click only selects; an open icon appears beside files, and you click it to open": "启用后，单击只会选取；文件旁边会出现打开符号，点它才打开",
    "How files open": "打开文件的方式",
    "Applies to single-click open, the right-click \"Open\" and the open icon": "应用于单击打开、右键「打开」与打开符号",
    "Open in current tab": "在当前标签页打开",
    "Open in new tab": "在新标签页打开",
    "Show an \"open in new tab\" icon beside the open icon": "打开符号旁显示「新标签页打开」符号",
    "Only shown when the previous option is \"Open in current tab\"": "仅在上一项为「在当前标签页打开」时显示",
    "Open icon color": "打开符号颜色",
    "Open icon opacity": "打开符号透明度",
    "\"Open in new tab\" icon color": "「新标签页打开」符号颜色",
    "\"Open in new tab\" icon opacity": "「新标签页打开」符号透明度",
    "Leave empty for the default color. Accepts color names, RGB or HEX": "留空 = 默认颜色。可填颜色名称、RGB、HEX",
    "Default color": "默认颜色",
    "Reset": "重置",
    "100% = opaque": "100% = 不透明",
    "New tab position": "新标签页打开的位置",
    "Used by the right-click \"Open in new tab to the right\" and the new-tab icon": "右键「在右侧新标签页打开」与新标签页符号使用",
    "Next to the current tab (default)": "在当前标签页旁边打开（默认）",
    "At the end of the tabs": "在标签页末尾打开",
    "Show times on hover": "鼠标停留时显示时间",
    "Hover over a file or folder to see its last modified and created times (also available via right-click \"Properties\")": "停留在文件或文件夹上，显示最后修改时间与创建时间（也可右键「属性」查看）",
    "Dim other levels while dragging when cross-level move is off": "跨层级移动关闭时，拖动让其他层级变灰",
    "While dragging, items not on the same level are dimmed": "拖动项目时，不属于同一层级的项目会变灰",
    "Dim level": "变灰程度",
    "The value is the visibility (%) of other-level items; lower is dimmer": "数值是其他层级项目的可见度（%），越小越灰",
    "Double-click interval (ms)": "双击判定时间（毫秒）",
    "Two clicks closer than this count as a double-click (rename). When the previous option is off, opening a file by single click is delayed by this long": "两次点击间隔小于此值视为双击（重命名）。未启用上一项时，单击打开文件会延迟这么久",
    "Folder scope when dragging into a focus zone": "拖动到专注区时的文件夹范围",
    "Include all sublevels": "包含所有子层",
    "Displayed info": "显示信息",
    "Folders: show file count": "文件夹：显示文件数量",
    "Folders: show subfolder count": "文件夹：显示子文件夹数量",
    "Counts include all sublevels (recursive)": "数量包含所有子层（递回）",
    "When off, only the current level is counted": "关闭时只计算当前层级",
    "Extensions counted as files": "计入文件数量的扩展名",
    "Comma-separated, e.g. md,png,pdf; use * for all": "以逗号分隔，例如 md,png,pdf；填 * 代表全部",
    "Files: show extension": "文件：显示扩展名",
    "Files: show created time": "文件：显示创建时间",
    "Files: show size": "文件：显示大小",
    "File info position": "文件信息显示位置",
    "Where the extension, created time, size and folder counts are placed": "扩展名、创建时间、大小、文件夹数量的摆放方式",
    "All after the file name": "全部显示在文件名称后面",
    "All below the file name (.md date size)": "全部显示在文件名称下方（.md 日期 大小）",
    "Extension after the name; created time and size below": "扩展名在名称后面，创建时间与大小在下方",
    "Size format": "大小显示方式",
    "Default: automatic unit (B / KB / MB…). Custom: choose the unit, decimals and base": "默认：自动选择单位（B／KB／MB…）。自订：指定单位、小数位数与进位基数",
    "Custom": "自订",
    "Unit": "单位",
    "Auto": "自动",
    "Decimal places": "小数位数",
    "Base": "进位基数",
    "1024 (KiB style)": "1024（KiB 式）",
    "1000 (SI style)": "1000（SI 式）",
    "Show full folder names": "文件夹显示完整名称",
    "When off, names that don't fit are truncated with \"…\" (off by default)": "关闭时，空间不足的名称会以「…」截断（默认关闭）",
    "Show full file names": "文件显示完整名称",
    "Wrap full names to the sidebar width": "完整名称依侧边栏宽度自动换行",
    "On (default): names wrap to the available width. Off: names stay on one line and can be scrolled sideways. Only applies when the two options above are on": "打开（默认）：名称依宽度自动换行。关闭：名称保持单行，过长时可左右滚动。仅在上面两项打开时有作用",
    "Appearance & theme compatibility": "外观与主题相容",
    "The list uses Obsidian's native style classes and the data-path attribute, so themes and CSS snippets usually apply directly. You can replace the symbols below; icons accept Lucide icon names, icon IDs registered by other plugins, or emoji/text. Set per-item icons and colors via right-click \"Appearance\".": "列表使用 Obsidian 原生的样式类别与 data-path 属性，主题与 CSS 片段通常能直接应用。下方可替换各种符号；图标可填 Lucide 图标名称、其他插件注册的图标 ID，或 emoji／文字。个别项目的图标与颜色请在右键「外观」设置。",
    "Use Obsidian's native style classes": "使用 Obsidian 原生样式类别",
    "Compatible with themes and CSS snippets; turn off if the layout looks wrong": "相容主题与 CSS 片段；若版面异常可关闭",
    "Show indent guides": "显示缩进线",
    "Show a line to the left of child items when a folder is expanded (on by default)": "展开文件夹时，子项目左侧显示一条线（默认打开）",
    "Indent guide color": "缩进线颜色",
    "Leave empty to follow the theme. Accepts color names, RGB or HEX": "留空 = 跟随主题。可填颜色名称、RGB、HEX",
    "Follow theme": "跟随主题",
    "Reset (follow theme)": "重置（跟随主题）",
    "Indent guide opacity": "缩进线透明度",
    "Indent guide thickness (px)": "缩进线粗细（px）",
    "Indent guide style template": "缩进线样式模板",
    "Choosing a template overwrites the line style, color, opacity, thickness, indent distance and advanced CSS below": "选择模板会覆盖下方的线型、颜色、透明度、粗细、缩进距离与进阶 CSS",
    "(Choose a template…)": "（选择模板…）",
    "Template: {0}": "模板：{0}",
    "Custom: {0}": "自订：{0}",
    "Indent guide line style": "缩进线线型",
    "Indent distance (px)": "缩进距离（px）",
    "How far each level of children is indented to the right": "每一层子项目向右缩进的距离",
    "Advanced: custom CSS declarations": "进阶：自订 CSS 宣告",
    "Only property declarations are accepted (e.g. box-shadow: …;). Use var(--ffm-guide-final) to get the final color after color and opacity are applied. For safety, url(), @-rules and braces are not allowed": "只接受属性宣告（例如 box-shadow: …;），可使用 var(--ffm-guide-final) 取得应用颜色与透明度后的最终色。出于安全，不允许 url()、@规则与大括号",
    "Style name": "样式名称",
    "Written to the file on export; after import it also appears in the template list under this name": "导出时写入文件，导入后也会以此名称出现在模板列表",
    "Export / import path": "导出／导入路径",
    "Relative path = a file in the vault; on desktop you can also enter a full path (e.g. D:\\\\styles\\\\guide.json). Folders are created automatically on export": "相对路径 = 库内的文件；桌面版也可填完整路径（例如 D:\\styles\\guide.json）。导出时会自动创建文件夹",
    "Export / import": "导出／导入",
    "\"Export template reference\" writes guide-style-templates.json to the same folder, containing all built-in templates, as a reference for custom styles": "「导出模板参考」会在同一个文件夹写出 guide-style-templates.json，内含所有内置模板，可当作自订样式的参考档",
    "Export current style": "导出当前样式",
    "Export template reference": "导出模板参考",
    "Manage imported styles": "管理导入的样式",
    "Display text size": "显示文字大小",
    "Default: follow Obsidian. Custom: set the list text size (px)": "默认：跟随 Obsidian。自订：指定列表文字大小（px）",
    "Follow Obsidian (default)": "跟随 Obsidian（默认）",
    "Text size (px)": "文字大小（px）",
    "Pin icon": "置顶符号",
    "Shown beside pinned items": "置顶的项目旁显示",
    "Show bookmark marks": "显示书签标记",
    "Synced with Obsidian bookmarks; bookmarked items get a mark beside them": "与 Obsidian 书签连动，已加入书签的项目旁显示标记",
    "Bookmark icon": "书签符号",
    "Other file types for right-click \"New\"": "右键「新增」的其他文件类型",
    "Base and Canvas are built in; Excalidraw also appears if the plugin is enabled. Other types: one per line in the format Name|extension|initial content (\\n = line break)": "Base、画布已内置；若已启用 Excalidraw 插件也会出现。其他类型每行一个，格式：名称|扩展名|初始内容（\\n 代表换行）",
    "Show icons beside folders": "显示文件夹旁的图标",
    "On by default": "默认打开",
    "Show icons beside files": "显示文件旁的图标",
    "Icon source": "图标来源",
    "Some themes (e.g. Rathgar Gold) draw their own folder and file icons. Auto: use the theme's icons when detected to avoid duplicates; you can also force the theme's or the plugin's icons": "有些主题（例如 Rathgar Gold）会自己画文件夹与文件图标。自动：侦测到主题有画就用主题的，避免重复；也可强制使用主题或插件的图标",
    "Auto (detect theme)": "自动（侦测主题）",
    "Use theme icons": "使用主题图标",
    "Use plugin icons (customizable below)": "使用插件图标（下方可自订）",
    "Expand / collapse arrow": "展开／折叠符号",
    "Auto: if the theme hides the expand arrow, it is hidden too (you can still click the folder row to expand); always shown when \"Clicking a folder does not expand/collapse\" is on": "自动：主题若隐藏了展开符号就跟著隐藏（仍可点文件夹列展开）；若已打开「点击文件夹不展开」则一定显示",
    "Auto (follow theme)": "自动（跟随主题）",
    "Always show": "一律显示",
    "Always hide": "一律隐藏",
    "Collapsed arrow": "折叠状态的符号",
    "Expanded arrow": "展开状态的符号",
    "Folder icon": "文件夹图标",
    "Folder icon (expanded)": "文件夹图标（展开时）",
    "File icon": "文件图标",
    "File icons by extension": "依扩展名指定文件图标",
    "One per line, format: extension=icon. E.g. md=file-text, png=image, pdf=📕": "每行一个，格式：扩展名=图标。例如 md=file-text、png=image、pdf=📕",
    "Restore default icons": "还原默认图标",
    "Hotkeys": "快捷键",
    "View-mode hotkeys": "显示模式快捷键",
    "All empty by default. You can assign hotkeys to the four commands \"Show file manager only\", \"Show focus zone only\", \"Show both\" and \"Cycle view\".": "默认皆为空白。可分别为「只显示文件管理」「只显示专注区」「两者同时显示」「循环切换」四个指令设置快捷键。",
    "Open hotkey settings": "打开快捷键设置",
    "Go to \"Settings → Hotkeys\" and search for \"Focus File Manager\"": "请到「设置 → 快捷键」搜寻「Focus File Manager」",
    "Open-file markers": "打开标记",
    "Symbol / icon name / emoji": "符号 / 图标名称 / emoji",
    "Reset symbol": "重置符号",
    "Color": "颜色",
    "Reset color": "重置颜色",
    "Currently displayed file": "当前显示中的文件",
    "A file whose tab is in the foreground and visible on screen (default: dot). The first box takes a symbol, Lucide icon name or emoji (pick an icon with the button on the right); the second takes a color (red, 255,0,0 and #FF0000 all work)": "标签页在前景、画面上看得到的文件（默认圆点）。第一格填符号、Lucide 图标名称或 emoji（右侧可选图标），第二格填颜色（红色、red、255,0,0、#FF0000 都可以）",
    "Open file (background tab)": "已打开（背景标签页）的文件",
    "A file that is open but whose tab is in the background (not currently shown) (default: square)": "已经打开、但标签页在背景（当前没显示）的文件（默认方点）",
    "Custom color names": "自订颜色名称",
    "One per line, format: name=color. E.g. \"vermilion=#ff4500\" or \"crimson=red\"": "每行一个，格式：名称=颜色。例如「朱红=#ff4500」或「红=red」",
    "Batch rename presets": "批量重命名方案",
    "Preset name": "方案名称",
    "Untitled": "未命名",
    "Name pattern / numbering": "名称格式 / 编号",
    "Delete this preset": "删除此方案",
    "Keep at least one preset": "至少要保留一个方案",
    "{n} number, {name} original name, {ext} extension, {i} order": "{n} 序号、{name} 原名称、{ext} 扩展名、{i} 顺序",
    "Add preset": "新增方案",
    "New preset": "新方案",
    "編號（100、200…）": "编号（100、200…）",
    "替換字符": "替换字符"
  },
  "ja": {
    "Numbering (100, 200…)": "連番（100、200…）",
    "Replace characters": "文字の置換",
    "File manager": "ファイル管理",
    "Focus zone": "フォーカスゾーン",
    "Both": "両方",
    "Default (Obsidian)": "デフォルト（Obsidian）",
    "Manual order": "手動並べ替え",
    "Name A → Z": "名前 A → Z",
    "Name Z → A": "名前 Z → A",
    "Modified: newest first": "更新日時：新しい順",
    "Modified: oldest first": "更新日時：古い順",
    "Created: newest first": "作成日時：新しい順",
    "Created: oldest first": "作成日時：古い順",
    "Solid": "実線",
    "Dashed": "破線",
    "Dotted": "点線",
    "Double": "二重線",
    "Default (follow theme)": "デフォルト（テーマに従う）",
    "Solid line; color and thickness follow the theme": "実線。色と太さはテーマに従います",
    "Light solid": "薄い実線",
    "Thin semi-transparent solid line": "半透明の細い実線",
    "Thin dashed line": "細い破線",
    "Round-dot line": "丸い点線",
    "Double-layer line": "二重の線",
    "Thick solid": "太い実線",
    "Bold, eye-catching line": "目立つ太い線",
    "Compact": "コンパクト",
    "Smaller indentation, good for narrow sidebars": "インデントが小さく、狭いサイドバー向け",
    "Gradient fade": "グラデーションでフェード",
    "Fades from top to bottom": "上から下へ徐々に薄くなります",
    "Glow": "グロー",
    "Soft glow around the line": "線の周りに柔らかい光",
    "Rounded thick bar": "角丸の太いバー",
    "Thick line with rounded ends": "両端が丸い太い線",
    "Imported style": "インポートしたスタイル",
    "Common": "よく使う",
    "Files": "ファイル",
    "Folders": "フォルダ",
    "Arrows": "矢印",
    "Marks": "マーク",
    "Tools": "ツール",
    "Life": "生活",
    "Fantasy": "ファンタジー",
    "Nature": "自然",
    "Search icon name (English)…": "アイコン名を検索（英語）…",
    "{0} in total": "全 {0} 個",
    "No matching icons": "該当するアイコンがありません",
    "All": "すべて",
    "OK": "OK",
    "Please confirm": "確認してください",
    "Cancel": "キャンセル",
    "Add to focus zone": "フォーカスゾーンに追加",
    "+ New focus zone…": "＋ 新しいフォーカスゾーン…",
    "New focus zone name": "新しいフォーカスゾーン名",
    "Folder scope": "フォルダの範囲",
    "Include all files and subfolders": "すべてのファイルとサブフォルダを含める",
    "Current level files only": "現在の階層のファイルのみ",
    "Add": "追加",
    "Please enter a focus zone name": "フォーカスゾーン名を入力してください",
    "Preset": "プリセット",
    "Add or edit presets in the plugin settings": "プラグイン設定でプリセットを追加・編集できます",
    "Apply": "適用",
    "Batch rename ({0} items)": "一括名前変更（{0} 件）",
    "Name pattern": "名前パターン",
    "Available: {n} number, {name} original name (without extension), {ext} extension, {i} order (1,2,3…)": "使用可能：{n} 連番、{name} 元の名前（拡張子なし）、{ext} 拡張子、{i} 順番（1,2,3…）",
    "Start number": "開始番号",
    "Step": "増分",
    "Zero-padding digits": "ゼロ埋めの桁数",
    "0 means no padding": "0 はゼロ埋めなし",
    "Find": "検索",
    "Replace with": "置換後",
    "Use regular expression": "正規表現を使う",
    "Case sensitive": "大文字小文字を区別",
    "Invalid name": "無効な名前",
    "Duplicate name": "名前が重複",
    "An item with the same name already exists": "同名の項目が既に存在します",
    "\"{0}\" → \"{1}\": {2}": "「{0}」→「{1}」：{2}",
    "No items to rename": "名前を変更する項目がありません",
    "Remove from this batch rename": "この一括名前変更から除外",
    "Renamed {0} items": "{0} 件の名前を変更しました",
    "Rename failed: ": "名前の変更に失敗：",
    "Choose icon": "アイコンを選択",
    "Appearance ({0} items)": "外観設定（{0} 件）",
    "Click an icon or template below to apply it immediately. You can also type a Lucide name, an icon ID registered by another plugin, or an emoji. Colors accept names (red), RGB (255,0,0) or HEX (#FF0000).": "下のアイコンまたはテンプレートをクリックすると即座に適用されます。Lucide 名、他のプラグインが登録したアイコン ID、絵文字も手入力できます。色は名前（red）、RGB（255,0,0）、HEX（#FF0000）で指定できます。",
    "My templates": "マイテンプレート",
    "(No templates saved yet)": "（保存されたテンプレートはまだありません）",
    "Click to apply this template": "クリックでこのテンプレートを適用",
    "Delete this template": "このテンプレートを削除",
    "+ Save current settings as template": "＋ 現在の設定をテンプレートとして保存",
    "Template name": "テンプレート名",
    "Saved template \"{0}\"": "テンプレート「{0}」を保存しました",
    "Icon": "アイコン",
    "Icon name / emoji": "アイコン名 / 絵文字",
    "Text color": "文字色",
    "Background color": "背景色",
    "Background opacity": "背景の不透明度",
    "100 = opaque; lower values are more transparent": "100 = 不透明。値が小さいほど透明になります",
    "Clear appearance": "外観をクリア",
    "Properties": "プロパティ",
    "Name": "名前",
    "Path": "パス",
    "Type": "種類",
    "Extension": "拡張子",
    "Size": "サイズ",
    "Contents": "内容",
    "{0} files, {1} subfolders (including all levels)": "{0} 個のファイル、{1} 個のサブフォルダ（全階層を含む）",
    "Created": "作成日時",
    "Last modified": "最終更新",
    "Selected": "選択中",
    "{0} items ({1} folders, {2} files)": "{0} 件（フォルダ {1}、ファイル {2}）",
    "Total size": "合計サイズ",
    "Back": "戻る",
    "Forward": "進む",
    "Up one level": "1つ上の階層へ",
    "\"Cross-level move\" is off; cannot move to another level": "「階層をまたぐ移動」がオフのため、他の階層へ移動できません",
    "Path copied": "パスをコピーしました",
    "Copy failed": "コピーに失敗しました",
    "Copy path": "パスをコピー",
    "Copy full path": "フルパスをコピー",
    "Selection mode ({0} selected)": "選択モード（{0} 件選択）",
    "Select all": "すべて選択",
    "Done": "選択を終了",
    "Temp · {0}": "一時 · {0}",
    "Pin to top": "先頭にピン留め",
    "Bookmarked": "ブックマーク済み",
    "{0} files": "{0} ファイル",
    "{0} folders": "{0} フォルダ",
    "Open": "開く",
    "Open to the right": "右側に開く",
    "Open in new window": "新しいウィンドウで開く",
    "Show in folder": "フォルダで表示",
    "Exit selection mode": "選択モードを終了",
    "Enter selection mode": "選択モードに入る",
    "Add to focus zone…": "フォーカスゾーンに追加…",
    "Remove from focus zone ({0})": "フォーカスゾーンから削除（{0}）",
    "Create temporary folder": "一時フォルダを作成",
    "Move to temporary folder…": "一時フォルダへ移動…",
    "Move out of temporary folder": "一時フォルダから出す",
    "Copy": "コピー",
    "Cut": "切り取り",
    "Paste": "貼り付け",
    "Remove bookmark": "ブックマークを削除",
    "Add bookmark": "ブックマークに追加",
    "Rename": "名前を変更",
    "Batch rename… ({0})": "一括名前変更…（{0}）",
    "Batch rename files inside folder…": "フォルダ内のファイルを一括名前変更…",
    "This folder has no files": "このフォルダにはファイルがありません",
    "Appearance (icon / color)…": "外観（アイコン／色）…",
    "Unpin": "ピン留めを解除",
    "Move up": "上へ",
    "Move down": "下へ",
    "Move up one level": "1つ上の階層へ移動",
    "Move down one level (into the previous folder)": "1つ下の階層へ移動（前のフォルダへ）",
    "Select all (visible)": "すべて選択（表示中）",
    "Select all (including collapsed)": "すべて選択（折りたたみ内も含む）",
    "New note here": "ここに新規ノート",
    "New folder here": "ここに新規フォルダ",
    "New {0} here": "ここに新規 {0}",
    "Properties…": "プロパティ…",
    "Delete": "削除",
    "Rename temporary folder": "一時フォルダの名前を変更",
    "Delete temporary folder (shortcuts move back to top level)": "一時フォルダを削除（ショートカットは最上位に戻ります）",
    "New focus zone": "新しいフォーカスゾーン",
    "Rename this focus zone": "このフォーカスゾーンの名前を変更",
    "Delete this focus zone": "このフォーカスゾーンを削除",
    "New note": "新規ノート",
    "New folder": "新規フォルダ",
    "New {0}": "新規 {0}",
    "Paste to root": "ルートに貼り付け",
    "Paste to current folder": "現在のフォルダに貼り付け",
    "Focus File Manager": "Focus File Manager",
    "(This folder is empty)": "（このフォルダは空です）",
    "(The vault is empty)": "（保管庫は空です）",
    "Select files/folders on the left, then right-click \"Add to focus zone\"": "左側でファイル／フォルダを選択し、右クリックで「フォーカスゾーンに追加」",
    "Right-click here to create a focus zone": "ここを右クリックしてフォーカスゾーンを作成",
    "Reset manual order…": "手動並べ替えをリセット…",
    "Reset the manual order? All manual ordering records will be cleared.": "手動並べ替えをリセットしますか？すべての手動並べ替えの記録が消去されます。",
    "Collapse all": "すべて折りたたむ",
    "Expand all": "すべて展開",
    "Refresh": "更新",
    "Refresh (manually refresh open-file markers)": "更新（開いているファイルのマークを手動で更新）",
    "Show: {0}": "表示：{0}",
    "Click to switch: File manager → Focus zone → Both (current: {0})": "クリックで切り替え：ファイル管理 → フォーカスゾーン → 両方（現在：{0}）",
    "On": "オン",
    "Off": "オフ",
    "Cross-level move: {0}": "階層をまたぐ移動：{0}",
    "Cross-level move (limits dragging): {0}": "階層をまたぐ移動（ドラッグを制限）：{0}",
    "Default": "デフォルト",
    "Manual": "手動",
    "Sort: {0}": "並べ替え：{0}",
    "Sort order: {0}": "並べ替え方法：{0}",
    "Collapse all (press again to switch to expand all)": "すべて折りたたむ（もう一度押すとすべて展開に切り替わります）",
    "Expand all (press again to switch to collapse all)": "すべて展開（もう一度押すとすべて折りたたみに切り替わります）",
    "+": "+",
    "Open Focus File Manager in sidebar": "サイドバーで Focus File Manager を開く",
    "Open Focus File Manager in main area": "メインエリアで Focus File Manager を開く",
    "Show file manager only": "ファイル管理のみ表示",
    "Show focus zone only": "フォーカスゾーンのみ表示",
    "Show both": "両方を表示",
    "Cycle view (File manager → Focus zone → Both)": "表示を切り替え（ファイル管理 → フォーカスゾーン → 両方）",
    "My indent guide style": "マイ・インデントガイドスタイル",
    "Language file exported: ": "言語ファイルをエクスポートしました：",
    "Export failed: ": "エクスポートに失敗：",
    "No usable translations in the file": "ファイルに使用可能な翻訳がありません",
    "Imported language \"{0}\" ({1} strings)": "言語「{0}」をインポートしました（{1} 件）",
    "Import failed: ": "インポートに失敗：",
    "Removed language \"{0}\"": "言語「{0}」を削除しました",
    "Please enter a path first": "先にパスを入力してください",
    "File not found: ": "ファイルが見つかりません：",
    "Indent guide style exported: ": "インデントガイドスタイルをエクスポートしました：",
    "Template reference exported: ": "テンプレート参考をエクスポートしました：",
    "Imported style {0}": "インポートしたスタイル {0}",
    "No usable styles in the file": "ファイルに使用可能なスタイルがありません",
    "Imported and applied \"{0}\"": "「{0}」をインポートして適用しました",
    "Imported {0} styles; choose one from \"Style template\"": "{0} 個のスタイルをインポートしました。「スタイルテンプレート」から選択してください",
    "Open in new tab at the end": "末尾の新しいタブで開く",
    "Open in new tab to the right": "右隣の新しいタブで開く",
    "Showing in folder is not supported on this platform": "このプラットフォームではフォルダで表示できません",
    "Last modified: {0}\nCreated: {1}": "最終更新：{0}\n作成：{1}",
    "Manual order reset": "手動並べ替えをリセットしました",
    "Switched to manual order": "手動並べ替えに切り替えました",
    "Cannot move a folder into itself": "フォルダを自分自身の中へ移動できません",
    "An item with the same name already exists at the destination: {0}": "移動先に同名の項目が既にあります：{0}",
    "Move failed: ": "移動に失敗：",
    "\"{0}\" is already at the top level": "「{0}」は既に最上位です",
    "No folder above \"{0}\" to move it into": "「{0}」の上に移動先のフォルダがありません",
    "The name contains invalid characters": "名前に使用できない文字が含まれています",
    "Delete {0} items? (moved to trash per Obsidian settings)": "{0} 件を削除しますか？（Obsidian の設定に従いごみ箱へ移動）",
    "Delete failed: ": "削除に失敗：",
    "Canvas": "キャンバス",
    "Excalidraw plugin not found; make sure it is enabled": "Excalidraw プラグインが見つかりません。有効になっているか確認してください",
    "Failed to create Excalidraw: ": "Excalidraw の作成に失敗：",
    "Create failed: ": "作成に失敗：",
    "The Obsidian core plugin \"Bookmarks\" is not enabled": "Obsidian のコアプラグイン「ブックマーク」が有効になっていません",
    "Bookmark operation failed: ": "ブックマーク操作に失敗：",
    "\"Cross-level move\" is off; cannot drop into another folder": "「階層をまたぐ移動」がオフのため、他のフォルダへドロップできません",
    "\"Cross-level move\" is off; you can only reorder within the same level": "「階層をまたぐ移動」がオフのため、同じ階層内でのみ並べ替えできます",
    "Only top-level items can be removed from a focus zone": "フォーカスゾーンから削除できるのは最上位の項目のみです",
    "Removed {0} items from the focus zone": "フォーカスゾーンから {0} 件を削除しました",
    "Cut {0} items": "{0} 件を切り取りました",
    "Copied {0} items": "{0} 件をコピーしました",
    "Paste failed: ": "貼り付けに失敗：",
    "Pasted {0} items": "{0} 件を貼り付けました",
    "No files or folders on the clipboard to paste": "貼り付けられるファイルやフォルダがクリップボードにありません",
    "Copied {0} paths": "{0} 件のパスをコピーしました",
    "Folder not found": "フォルダが見つかりません",
    "Please create a focus zone first": "先にフォーカスゾーンを作成してください",
    "Delete temporary folder \"{0}\"? Its shortcuts will move back to the top level of the focus zone (real files are not deleted).": "一時フォルダ「{0}」を削除しますか？中のショートカットはフォーカスゾーンの最上位に戻ります（実際のファイルは削除されません）。",
    "Only shortcuts inside a focus zone can be moved": "移動できるのはフォーカスゾーン内のショートカットのみです",
    "Rename focus zone": "フォーカスゾーン名を変更",
    "Delete focus zone \"{0}\"? (real files are not deleted)": "フォーカスゾーン「{0}」を削除しますか？（実際のファイルは削除されません）",
    "Move left": "左へ移動",
    "Move right": "右へ移動",
    "Delete focus zone": "フォーカスゾーンを削除",
    "Added to \"{0}\"{1}": "「{0}」に追加しました{1}",
    "Language": "言語",
    "Interface language": "表示言語",
    "Follows the system (Obsidian) language by default; English is used if the language is not available. Japanese and Simplified Chinese are machine translations and may be inaccurate. Command names update after reloading the plugin.": "デフォルトではシステム（Obsidian）の言語に従い、対応する言語がない場合は英語を使用します。日本語と簡体字中国語は機械翻訳のため、不正確な場合があります。コマンド名はプラグインを再読み込みすると更新されます。",
    "Follow system": "システムに従う",
    "Language file path": "言語ファイルのパス",
    "Relative path = a file in the vault; on desktop you can also enter a full path. The exported JSON uses English as the default template: edit the translations inside \"strings\", then import it. Imported languages are listed by file name after the built-in languages.": "相対パス = 保管庫内のファイル。デスクトップ版ではフルパスも指定できます。エクスポートされる JSON は英語がデフォルトのテンプレートです。strings 内の翻訳を編集してからインポートしてください。インポートした言語はファイル名で組み込み言語の後ろに表示されます。",
    "Export / import language": "言語のエクスポート／インポート",
    "Export English template": "英語テンプレートをエクスポート",
    "Export current language": "現在の言語をエクスポート",
    "Import": "インポート",
    "Manage imported languages": "インポートした言語の管理",
    "Remove": "削除",
    "Behavior": "操作",
    "File manager style": "ファイル管理のスタイル",
    "Default: tree (expandable subfolders). Explorer: path bar on top, one level at a time, click a folder to enter it (focus zones are unaffected)": "デフォルト：ツリー（サブフォルダを展開可能）。エクスプローラー風：上部にパスを表示し、一度に1階層のみ表示、フォルダをクリックして入ります（フォーカスゾーンは影響を受けません）",
    "Default (tree)": "デフォルト（ツリー）",
    "Explorer (level by level)": "エクスプローラー風（階層ごと）",
    "Sort order": "並べ替え方法",
    "You can also switch with the sort button on the toolbar. For time-based sorting, a folder uses the time of the newest (modified) or oldest (created) file inside it": "ツールバーの並べ替えボタンでも切り替えられます。時間順では、フォルダは中の最新（更新）または最古（作成）のファイルの時刻を基準にします",
    "Folders before files when sorting": "並べ替え時にフォルダをファイルより前に配置",
    "On by default (same as Obsidian)": "デフォルトでオン（Obsidian と同じ）",
    "Exclude items from \"Expand all / Collapse all\"": "「すべて展開／すべて折りたたむ」から指定項目を除外",
    "When enabled, folders matching the list below are not affected by Expand all or Collapse all and keep their current state": "有効にすると、下のリストに一致するフォルダは「すべて展開」「すべて折りたたむ」の影響を受けず、現在の状態を維持します",
    "Exclusion list": "除外リスト",
    "One per line. A name only (e.g. Attachments) = any folder with that name; a path (e.g. Projects/Archive) = the folder at that path. Wildcards * and ? are supported": "1行に1件。名前のみ（例：Attachments）＝どこにある同名フォルダも対象。パス（例：Projects/Archive）＝そのパスのフォルダ。ワイルドカード * と ? が使えます",
    "Top view-mode button style": "上部の表示切り替えボタンのスタイル",
    "\"File manager / Focus zone / Both\": separate buttons, or one merged icon button that cycles": "「ファイル管理／フォーカスゾーン／両方」：個別のボタン、または循環切り替えする1つのアイコンボタン",
    "Separate buttons": "個別ボタン",
    "Cycle button (merged)": "循環ボタン（統合）",
    "Top button appearance": "上部ボタンの外観",
    "Use icons like Obsidian's built-in file explorer (description shown on hover), icons with text, or plain text": "Obsidian 標準のファイルエクスプローラーのようにアイコン（ホバーで説明を表示）、アイコン＋テキスト、またはテキストのみ",
    "Text buttons": "テキストボタン",
    "Icon buttons (description as tooltip)": "アイコンボタン（説明はツールチップ）",
    "Icon + text label": "アイコン＋テキスト",
    "Merge \"Collapse all / Expand all\" into one button": "「すべて折りたたむ／すべて展開」を1つのボタンに統合",
    "Like the built-in file explorer: the button reads \"Collapse all\" when something is expanded, otherwise \"Expand all\"": "標準のファイルエクスプローラーと同様に、展開中の項目があるときは「すべて折りたたむ」、なければ「すべて展開」になります",
    "Clicking a folder does not expand/collapse": "フォルダのクリックで展開／折りたたみしない",
    "When enabled, only the arrow beside a folder expands or collapses it": "有効にすると、フォルダ横の矢印をクリックしたときだけ展開／折りたたみされます",
    "Single click does not open files": "シングルクリックでファイルを開かない",
    "When enabled, a single click only selects; an open icon appears beside files, and you click it to open": "有効にすると、シングルクリックは選択のみ。ファイルの横に開くアイコンが表示され、それをクリックして開きます",
    "How files open": "ファイルの開き方",
    "Applies to single-click open, the right-click \"Open\" and the open icon": "シングルクリックで開く、右クリックの「開く」、開くアイコンに適用されます",
    "Open in current tab": "現在のタブで開く",
    "Open in new tab": "新しいタブで開く",
    "Show an \"open in new tab\" icon beside the open icon": "開くアイコンの横に「新しいタブで開く」アイコンを表示",
    "Only shown when the previous option is \"Open in current tab\"": "前の項目が「現在のタブで開く」の場合のみ表示されます",
    "Open icon color": "開くアイコンの色",
    "Open icon opacity": "開くアイコンの不透明度",
    "\"Open in new tab\" icon color": "「新しいタブで開く」アイコンの色",
    "\"Open in new tab\" icon opacity": "「新しいタブで開く」アイコンの不透明度",
    "Leave empty for the default color. Accepts color names, RGB or HEX": "空欄 = デフォルトの色。色名、RGB、HEX を指定できます",
    "Default color": "デフォルトの色",
    "Reset": "リセット",
    "100% = opaque": "100% = 不透明",
    "New tab position": "新しいタブの位置",
    "Used by the right-click \"Open in new tab to the right\" and the new-tab icon": "右クリックの「右隣の新しいタブで開く」と新しいタブのアイコンで使用されます",
    "Next to the current tab (default)": "現在のタブの隣（デフォルト）",
    "At the end of the tabs": "タブの末尾",
    "Show times on hover": "ホバー時に日時を表示",
    "Hover over a file or folder to see its last modified and created times (also available via right-click \"Properties\")": "ファイルやフォルダにカーソルを合わせると最終更新日時と作成日時を表示します（右クリックの「プロパティ」でも確認できます）",
    "Dim other levels while dragging when cross-level move is off": "階層をまたぐ移動がオフのとき、ドラッグ中に他の階層を暗くする",
    "While dragging, items not on the same level are dimmed": "ドラッグ中、同じ階層にない項目が暗くなります",
    "Dim level": "暗くする度合い",
    "The value is the visibility (%) of other-level items; lower is dimmer": "他の階層の項目の見え方（%）です。小さいほど暗くなります",
    "Double-click interval (ms)": "ダブルクリック判定時間（ミリ秒）",
    "Two clicks closer than this count as a double-click (rename). When the previous option is off, opening a file by single click is delayed by this long": "2回のクリック間隔がこの値より短い場合はダブルクリック（名前変更）とみなします。前の項目がオフの場合、シングルクリックでファイルを開くのがこの時間だけ遅れます",
    "Folder scope when dragging into a focus zone": "フォーカスゾーンへドラッグするときのフォルダ範囲",
    "Include all sublevels": "すべての階層を含める",
    "Displayed info": "表示情報",
    "Folders: show file count": "フォルダ：ファイル数を表示",
    "Folders: show subfolder count": "フォルダ：サブフォルダ数を表示",
    "Counts include all sublevels (recursive)": "件数に全階層を含める（再帰）",
    "When off, only the current level is counted": "オフの場合は現在の階層のみ数えます",
    "Extensions counted as files": "ファイル数に含める拡張子",
    "Comma-separated, e.g. md,png,pdf; use * for all": "カンマ区切り（例：md,png,pdf）。* ですべて",
    "Files: show extension": "ファイル：拡張子を表示",
    "Files: show created time": "ファイル：作成日時を表示",
    "Files: show size": "ファイル：サイズを表示",
    "File info position": "ファイル情報の表示位置",
    "Where the extension, created time, size and folder counts are placed": "拡張子・作成日時・サイズ・フォルダ内の件数の配置",
    "All after the file name": "すべてファイル名の後ろ",
    "All below the file name (.md date size)": "すべてファイル名の下（.md 日付 サイズ）",
    "Extension after the name; created time and size below": "拡張子は名前の後ろ、作成日時とサイズは下",
    "Size format": "サイズの表示形式",
    "Default: automatic unit (B / KB / MB…). Custom: choose the unit, decimals and base": "デフォルト：単位を自動選択（B／KB／MB…）。カスタム：単位、小数桁数、基数を指定",
    "Custom": "カスタム",
    "Unit": "単位",
    "Auto": "自動",
    "Decimal places": "小数桁数",
    "Base": "基数",
    "1024 (KiB style)": "1024（KiB 方式）",
    "1000 (SI style)": "1000（SI 方式）",
    "Show full folder names": "フォルダ名を省略せずに表示",
    "When off, names that don't fit are truncated with \"…\" (off by default)": "オフの場合、収まらない名前は「…」で省略されます（デフォルトはオフ）",
    "Show full file names": "ファイル名を省略せずに表示",
    "Wrap full names to the sidebar width": "完全な名前をサイドバーの幅で折り返す",
    "On (default): names wrap to the available width. Off: names stay on one line and can be scrolled sideways. Only applies when the two options above are on": "オン（デフォルト）：幅に合わせて折り返します。オフ：1行のままで、長い場合は横スクロールできます。上の2項目がオンのときのみ有効です",
    "Appearance & theme compatibility": "外観とテーマ互換性",
    "The list uses Obsidian's native style classes and the data-path attribute, so themes and CSS snippets usually apply directly. You can replace the symbols below; icons accept Lucide icon names, icon IDs registered by other plugins, or emoji/text. Set per-item icons and colors via right-click \"Appearance\".": "リストは Obsidian ネイティブのスタイルクラスと data-path 属性を使うため、テーマや CSS スニペットは通常そのまま適用されます。下で各種シンボルを置き換えられます。アイコンには Lucide のアイコン名、他のプラグインが登録したアイコン ID、または絵文字／テキストを指定できます。個別項目のアイコンと色は右クリックの「外観」で設定してください。",
    "Use Obsidian's native style classes": "Obsidian ネイティブのスタイルクラスを使用",
    "Compatible with themes and CSS snippets; turn off if the layout looks wrong": "テーマや CSS スニペットと互換。レイアウトが崩れる場合はオフにしてください",
    "Show indent guides": "インデントガイドを表示",
    "Show a line to the left of child items when a folder is expanded (on by default)": "フォルダを展開したとき、子項目の左側に線を表示します（デフォルトでオン）",
    "Indent guide color": "インデントガイドの色",
    "Leave empty to follow the theme. Accepts color names, RGB or HEX": "空欄 = テーマに従います。色名、RGB、HEX を指定できます",
    "Follow theme": "テーマに従う",
    "Reset (follow theme)": "リセット（テーマに従う）",
    "Indent guide opacity": "インデントガイドの不透明度",
    "Indent guide thickness (px)": "インデントガイドの太さ（px）",
    "Indent guide style template": "インデントガイドのスタイルテンプレート",
    "Choosing a template overwrites the line style, color, opacity, thickness, indent distance and advanced CSS below": "テンプレートを選ぶと、下の線種・色・不透明度・太さ・インデント距離・詳細 CSS が上書きされます",
    "(Choose a template…)": "（テンプレートを選択…）",
    "Template: {0}": "テンプレート：{0}",
    "Custom: {0}": "カスタム：{0}",
    "Indent guide line style": "インデントガイドの線種",
    "Indent distance (px)": "インデント距離（px）",
    "How far each level of children is indented to the right": "各階層の子項目を右へインデントする距離",
    "Advanced: custom CSS declarations": "詳細：カスタム CSS 宣言",
    "Only property declarations are accepted (e.g. box-shadow: …;). Use var(--ffm-guide-final) to get the final color after color and opacity are applied. For safety, url(), @-rules and braces are not allowed": "プロパティ宣言のみ使用できます（例：box-shadow: …;）。色と不透明度を適用した最終色は var(--ffm-guide-final) で取得できます。安全のため、url()、@ ルール、波括弧は使用できません",
    "Style name": "スタイル名",
    "Written to the file on export; after import it also appears in the template list under this name": "エクスポート時にファイルへ書き込まれ、インポート後もこの名前でテンプレート一覧に表示されます",
    "Export / import path": "エクスポート／インポートのパス",
    "Relative path = a file in the vault; on desktop you can also enter a full path (e.g. D:\\\\styles\\\\guide.json). Folders are created automatically on export": "相対パス = 保管庫内のファイル。デスクトップ版ではフルパス（例：D:\\\\styles\\\\guide.json）も指定できます。エクスポート時にフォルダは自動作成されます",
    "Export / import": "エクスポート／インポート",
    "\"Export template reference\" writes guide-style-templates.json to the same folder, containing all built-in templates, as a reference for custom styles": "「テンプレート参考をエクスポート」は同じフォルダに guide-style-templates.json を書き出します。すべての組み込みテンプレートが含まれ、カスタムスタイルの参考になります",
    "Export current style": "現在のスタイルをエクスポート",
    "Export template reference": "テンプレート参考をエクスポート",
    "Manage imported styles": "インポートしたスタイルの管理",
    "Display text size": "表示する文字サイズ",
    "Default: follow Obsidian. Custom: set the list text size (px)": "デフォルト：Obsidian に従う。カスタム：リストの文字サイズ（px）を指定",
    "Follow Obsidian (default)": "Obsidian に従う（デフォルト）",
    "Text size (px)": "文字サイズ（px）",
    "Pin icon": "ピン留めアイコン",
    "Shown beside pinned items": "ピン留めした項目の横に表示",
    "Show bookmark marks": "ブックマークマークを表示",
    "Synced with Obsidian bookmarks; bookmarked items get a mark beside them": "Obsidian のブックマークと連動し、ブックマーク済みの項目の横にマークを表示します",
    "Bookmark icon": "ブックマークアイコン",
    "Other file types for right-click \"New\"": "右クリック「新規」の追加ファイル種類",
    "Base and Canvas are built in; Excalidraw also appears if the plugin is enabled. Other types: one per line in the format Name|extension|initial content (\\n = line break)": "Base とキャンバスは組み込み済み。Excalidraw プラグインが有効なら Excalidraw も表示されます。その他の種類は1行に1件、形式：名前|拡張子|初期内容（\\n = 改行）",
    "Show icons beside folders": "フォルダの横にアイコンを表示",
    "On by default": "デフォルトでオン",
    "Show icons beside files": "ファイルの横にアイコンを表示",
    "Icon source": "アイコンの取得元",
    "Some themes (e.g. Rathgar Gold) draw their own folder and file icons. Auto: use the theme's icons when detected to avoid duplicates; you can also force the theme's or the plugin's icons": "一部のテーマ（例：Rathgar Gold）は独自のフォルダ／ファイルアイコンを描画します。自動：テーマのアイコンが検出されたら重複を避けるためそれを使用します。テーマまたはプラグインのアイコンを強制することもできます",
    "Auto (detect theme)": "自動（テーマを検出）",
    "Use theme icons": "テーマのアイコンを使用",
    "Use plugin icons (customizable below)": "プラグインのアイコンを使用（下でカスタマイズ可能）",
    "Expand / collapse arrow": "展開／折りたたみ矢印",
    "Auto: if the theme hides the expand arrow, it is hidden too (you can still click the folder row to expand); always shown when \"Clicking a folder does not expand/collapse\" is on": "自動：テーマが展開矢印を非表示にしている場合は同様に非表示にします（フォルダ行のクリックで展開は可能）。「フォルダのクリックで展開／折りたたみしない」がオンの場合は常に表示されます",
    "Auto (follow theme)": "自動（テーマに従う）",
    "Always show": "常に表示",
    "Always hide": "常に非表示",
    "Collapsed arrow": "折りたたみ状態の矢印",
    "Expanded arrow": "展開状態の矢印",
    "Folder icon": "フォルダアイコン",
    "Folder icon (expanded)": "フォルダアイコン（展開時）",
    "File icon": "ファイルアイコン",
    "File icons by extension": "拡張子ごとのファイルアイコン",
    "One per line, format: extension=icon. E.g. md=file-text, png=image, pdf=📕": "1行に1件。形式：拡張子=アイコン。例：md=file-text、png=image、pdf=📕",
    "Restore default icons": "デフォルトのアイコンに戻す",
    "Hotkeys": "ホットキー",
    "View-mode hotkeys": "表示モードのホットキー",
    "All empty by default. You can assign hotkeys to the four commands \"Show file manager only\", \"Show focus zone only\", \"Show both\" and \"Cycle view\".": "デフォルトはすべて空です。「ファイル管理のみ表示」「フォーカスゾーンのみ表示」「両方を表示」「表示を切り替え」の4つのコマンドにホットキーを割り当てられます。",
    "Open hotkey settings": "ホットキー設定を開く",
    "Go to \"Settings → Hotkeys\" and search for \"Focus File Manager\"": "「設定 → ホットキー」で「Focus File Manager」を検索してください",
    "Open-file markers": "開いているファイルのマーク",
    "Symbol / icon name / emoji": "記号 / アイコン名 / 絵文字",
    "Reset symbol": "記号をリセット",
    "Color": "色",
    "Reset color": "色をリセット",
    "Currently displayed file": "現在表示中のファイル",
    "A file whose tab is in the foreground and visible on screen (default: dot). The first box takes a symbol, Lucide icon name or emoji (pick an icon with the button on the right); the second takes a color (red, 255,0,0 and #FF0000 all work)": "タブが前面にあり画面に表示されているファイル（デフォルト：丸）。1つ目の欄には記号、Lucide アイコン名、絵文字を入力（右のボタンでアイコンを選択可）。2つ目の欄には色を入力（red、255,0,0、#FF0000 など）",
    "Open file (background tab)": "開いているファイル（バックグラウンドタブ）",
    "A file that is open but whose tab is in the background (not currently shown) (default: square)": "開いているが、タブがバックグラウンドにある（現在表示されていない）ファイル（デフォルト：四角）",
    "Custom color names": "カスタム色名",
    "One per line, format: name=color. E.g. \"vermilion=#ff4500\" or \"crimson=red\"": "1行に1件。形式：名前=色。例：「朱色=#ff4500」「紅=red」",
    "Batch rename presets": "一括名前変更のプリセット",
    "Preset name": "プリセット名",
    "Untitled": "無題",
    "Name pattern / numbering": "名前パターン / 連番",
    "Delete this preset": "このプリセットを削除",
    "Keep at least one preset": "プリセットは少なくとも1つ必要です",
    "{n} number, {name} original name, {ext} extension, {i} order": "{n} 連番、{name} 元の名前、{ext} 拡張子、{i} 順番",
    "Add preset": "プリセットを追加",
    "New preset": "新しいプリセット",
    "編號（100、200…）": "連番（100、200…）",
    "替換字符": "文字の置換"
  }
};
const LANG_KEYS = Object.keys(LANG_DATA['zh-TW'] || {});
let I18N = { code: 'en', map: null };
function _t(key, ...args) {
  let s = key;
  if (I18N.map && Object.prototype.hasOwnProperty.call(I18N.map, key)) {
    const v = I18N.map[key];
    if (typeof v === 'string' && v) s = v;
  }
  if (args.length) s = s.replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m));
  return s;
}
function detectSystemLocale() {
  let loc = '';
  try { loc = (obsidian.moment && obsidian.moment.locale && obsidian.moment.locale()) || ''; } catch (e) { /* ignore */ }
  if (!loc) { try { loc = window.localStorage.getItem('language') || ''; } catch (e) { /* ignore */ } }
  if (!loc) loc = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return String(loc).toLowerCase();
}
function builtinFor(loc) {
  if (/^zh[-_](tw|hk|mo|hant)/.test(loc)) return 'zh-TW';
  if (/^zh/.test(loc)) return 'zh-CN';
  if (/^ja/.test(loc)) return 'ja';
  if (/^en/.test(loc)) return 'en';
  return null;
}

const SORT_MODES = {
  default: "Default (Obsidian)", manual: "Manual order",
  'name-asc': "Name A → Z", 'name-desc': "Name Z → A",
  'mtime-desc': "Modified: newest first", 'mtime-asc': "Modified: oldest first",
  'ctime-desc': "Created: newest first", 'ctime-asc': "Created: oldest first",
};
const GUIDE_LINES = ['solid', 'dashed', 'dotted', 'double'];
const GUIDE_LINE_NAMES = { solid: "Solid", dashed: "Dashed", dotted: "Dotted", double: "Double" };
// 縮排線範本：css 欄位可使用 var(--ffm-guide-final)（已套用顏色與透明度的最終色）
const GUIDE_TEMPLATES = [
  { name: "Default (follow theme)", description: "Solid line; color and thickness follow the theme", lineStyle: 'solid', width: 1, opacity: 100, color: '', offset: 12, css: '' },
  { name: "Light solid", description: "Thin semi-transparent solid line", lineStyle: 'solid', width: 1, opacity: 40, color: '', offset: 12, css: '' },
  { name: "Dashed", description: "Thin dashed line", lineStyle: 'dashed', width: 1, opacity: 70, color: '', offset: 12, css: '' },
  { name: "Dotted", description: "Round-dot line", lineStyle: 'dotted', width: 2, opacity: 80, color: '', offset: 12, css: '' },
  { name: "Double", description: "Double-layer line", lineStyle: 'double', width: 3, opacity: 70, color: '', offset: 12, css: '' },
  { name: "Thick solid", description: "Bold, eye-catching line", lineStyle: 'solid', width: 3, opacity: 60, color: '', offset: 12, css: '' },
  { name: "Compact", description: "Smaller indentation, good for narrow sidebars", lineStyle: 'solid', width: 1, opacity: 60, color: '', offset: 6, css: '' },
  { name: "Gradient fade", description: "Fades from top to bottom", lineStyle: 'solid', width: 2, opacity: 100, color: '', offset: 12,
    css: 'border-left: none; background-image: linear-gradient(to bottom, var(--ffm-guide-final), transparent); background-size: var(--ffm-guide-width, 2px) 100%; background-repeat: no-repeat; background-position: left top;' },
  { name: "Glow", description: "Soft glow around the line", lineStyle: 'solid', width: 1, opacity: 100, color: '', offset: 12, css: 'box-shadow: -1px 0 6px -1px var(--ffm-guide-final);' },
  { name: "Rounded thick bar", description: "Thick line with rounded ends", lineStyle: 'solid', width: 3, opacity: 70, color: '', offset: 12, css: 'border-radius: 3px 0 0 3px;' },
];
// 自訂 CSS 只接受屬性宣告：移除 url()、@規則、大括號與註解
function sanitizeGuideCss(css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\s*\([^)]*\)/gi, '').replace(/@[a-z-]+/gi, '').replace(/[{}<>]/g, '').trim().slice(0, 2000);
}
function normalizeGuideStyle(o, fallbackName) {
  if (!o || typeof o !== 'object') return null;
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    name: String(o.name || fallbackName || _t("Imported style")).slice(0, 60),
    description: String(o.description || '').slice(0, 200),
    lineStyle: GUIDE_LINES.includes(o.lineStyle) ? o.lineStyle : 'solid',
    width: num(o.width, 1, 8, 1),
    opacity: num(o.opacity, 5, 100, 100),
    color: String(o.color || '').slice(0, 60),
    offset: num(o.offset, 0, 40, 12),
    css: sanitizeGuideCss(o.css),
  };
}

const ICON_CATEGORIES = [
  ["Common", 'star heart bookmark flag pin zap flame sparkles lightbulb bell circle square triangle diamond hexagon tag check-circle alert-circle info help-circle gem crown'],
  ["Files", 'file file-text file-plus file-code file-image file-video file-audio file-spreadsheet file-json file-archive file-lock file-check file-heart files notebook book book-open scroll clipboard sticky-note'],
  ["Folders", 'folder folder-open folder-plus folder-heart folder-tree folder-archive folder-lock folder-check folder-git folder-kanban folder-search folder-sync folder-clock folder-cog archive inbox library layers package'],
  ["Arrows", 'chevron-right chevron-down chevron-up chevron-left chevrons-right chevrons-down arrow-right arrow-down arrow-up arrow-left corner-down-right play move'],
  ["Marks", 'circle-dot check x plus minus bookmark-check award trophy medal shield lock key eye eye-off target crosshair infinity percent hash'],
  ["Tools", 'settings wrench hammer cog sliders-horizontal filter search link paperclip scissors pencil paintbrush palette terminal code database server cloud download upload'],
  ["Life", 'home user users calendar clock map-pin map globe mail phone camera image music video gamepad-2 compass backpack shopping-cart gift coffee'],
  ["Fantasy", 'sword swords shield castle skull ghost wand-2 dice-1 dice-5 scroll-text flask-conical axe crown gem flame moon sun'],
  ["Nature", 'sun moon cloud leaf tree-pine flower mountain droplet snowflake wind rainbow'],
  ['Emoji', '📁 📂 📄 📝 ⭐ ❤️ 🔥 ✨ 📌 🔖 🏷️ 📚 🎲 ⚔️ 🛡️ 🏰 🗺️ 🧙 🐉 💎 🔑 ✅ ❌ ⚠️ 💡 🎯 🧩 📎 🔒 🌟 🎨 🎵 🖼️ 👤 🏠 📅 ⏰ 🌲 🌙 ☀️'],
].map(([name, list]) => ({ name, icons: list.split(/\s+/).filter(Boolean) }));

// 圖示選擇格：「全部」與分類頁籤 + 搜尋。點擊圖示呼叫 onPick(名稱)
function buildIconGrid(host, onPick, current) {
  host.empty();
  let ids = new Set();
  try { ids = new Set(obsidian.getIconIds ? obsidian.getIconIds() : []); } catch (e) { ids = new Set(); }
  const isName = (n) => /^[a-z0-9-]+$/i.test(n);
  const exists = (n) => !ids.size || ids.has('lucide-' + n) || ids.has(n);
  let allList = null;
  const getAll = () => {
    if (!allList) {
      allList = ids.size
        ? [...new Set([...ids].map((x) => x.replace(/^lucide-/, '')))].sort()
        : [...new Set(ICON_CATEGORIES.filter((c) => c.name !== 'Emoji').flatMap((c) => c.icons))];
    }
    return allList;
  };
  const search = host.createEl('input', { type: 'text', cls: 'ffm-icon-search' });
  search.placeholder = _t("Search icon name (English)…");
  const tabs = host.createDiv({ cls: 'ffm-icon-tabs' });
  const count = host.createDiv({ cls: 'ffm-icon-count' });
  const grid = host.createDiv({ cls: 'ffm-icon-grid' });
  const CHUNK = 180;
  let token = 0;
  const draw = (list) => {
    const mine = ++token;
    grid.empty();
    count.setText(_t("{0} in total", list.length));
    let shown = 0;
    const add = (name) => {
      const b = grid.createDiv({ cls: 'ffm-icon-cell' });
      if (name === current) b.addClass('is-current');
      if (isName(name)) setIcon(b, name); else b.setText(name);
      b.setAttr('aria-label', name);
      b.onclick = () => onPick(name);
    };
    const more = () => { list.slice(shown, shown + CHUNK).forEach(add); shown += CHUNK; };
    more();
    grid.onscroll = () => {
      if (mine === token && shown < list.length && grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 60) more();
    };
    if (!list.length) grid.createDiv({ cls: 'ffm-empty', text: _t("No matching icons") });
  };
  const tabDefs = [{ name: _t("All"), all: true }].concat(ICON_CATEGORIES);
  let active = 1;
  const showCat = (i) => {
    active = i;
    tabs.querySelectorAll('.ffm-icon-tab').forEach((x, k) => x.toggleClass('is-active', k === i));
    const c = tabDefs[i];
    draw(c.all ? getAll() : c.icons.filter((n) => !isName(n) || exists(n)));
  };
  tabDefs.forEach((c, i) => {
    const tab = tabs.createDiv({ cls: 'ffm-icon-tab', text: _t(c.name) });
    tab.onclick = () => { search.value = ''; showCat(i); };
  });
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { showCat(active); return; }
    draw(getAll().filter((x) => x.toLowerCase().includes(q)));
  });
  showCat(1);
}

/* ------------------------------ 顏色 ------------------------------ */
const COLOR_MAP = {
  '紅色': '#e53935', '紅': '#e53935', '红色': '#e53935', red: '#e53935',
  '橙色': '#fb8c00', '橘色': '#fb8c00', '橙': '#fb8c00', orange: '#fb8c00',
  '黃色': '#fdd835', '黄色': '#fdd835', '黃': '#fdd835', yellow: '#fdd835',
  '綠色': '#43a047', '绿色': '#43a047', '綠': '#43a047', green: '#43a047',
  '青色': '#00acc1', cyan: '#00acc1',
  '藍色': '#1e88e5', '蓝色': '#1e88e5', '藍': '#1e88e5', blue: '#1e88e5',
  '紫色': '#8e24aa', '紫': '#8e24aa', purple: '#8e24aa',
  '粉紅色': '#ec407a', '粉色': '#ec407a', '粉红色': '#ec407a', pink: '#ec407a',
  '灰色': '#9e9e9e', '灰': '#9e9e9e', gray: '#9e9e9e', grey: '#9e9e9e',
  '黑色': '#000000', black: '#000000',
  '白色': '#ffffff', white: '#ffffff',
  '棕色': '#8d6e63', '咖啡色': '#8d6e63', brown: '#8d6e63',
};

function parseColor(input, aliasMap, depth = 0) {
  let s = String(input || '').trim();
  if (!s) return 'var(--text-accent)';
  const key = s.toLowerCase();
  if (aliasMap && aliasMap[key] !== undefined && depth < 3) return parseColor(aliasMap[key], aliasMap, depth + 1);
  if (COLOR_MAP[key] || COLOR_MAP[s]) return COLOR_MAP[key] || COLOR_MAP[s];
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
  if (/^\(?\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*\)?$/.test(s)) {
    const n = s.match(/\d+/g).map((x) => Math.min(255, Number(x)));
    return `rgb(${n[0]}, ${n[1]}, ${n[2]})`;
  }
  return s; // 其他交給 CSS（rgb(...)、hsl(...)、英文顏色名等）
}

/* ------------------------------ 工具 ------------------------------ */
const parentPath = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '/' : p.slice(0, i); };
const joinPath = (dir, name) => (!dir || dir === '/' ? name : dir + '/' + name);
const uid = () => Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const INVALID_NAME = /[\\/:*?"<>|]/;

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
function fmtDate(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function pruneNested(files) {
  return files.filter((f) => !files.some((o) => o !== f && f.path.startsWith(o.path + '/')));
}
function shiftSelected(arr, isSel, dir) {
  const a = [...arr];
  if (dir < 0) {
    for (let i = 1; i < a.length; i++) if (isSel(a[i]) && !isSel(a[i - 1])) [a[i - 1], a[i]] = [a[i], a[i - 1]];
  } else {
    for (let i = a.length - 2; i >= 0; i--) if (isSel(a[i]) && !isSel(a[i + 1])) [a[i + 1], a[i]] = [a[i], a[i + 1]];
  }
  return a;
}

/* 批量重新命名：計算新名稱（目前支援「模式/編號」與「替換字符」） */
function computeNewNames(items, preset) {
  return items.map((f, i) => {
    const isF = f instanceof TFolder;
    const ext = isF ? '' : f.extension ? '.' + f.extension : '';
    const base = isF ? f.name : f.basename;
    let nb = base;
    if (preset.type === 'pattern') {
      const num = Number(preset.start) + i * Number(preset.step);
      const n = String(num).padStart(Number(preset.pad) || 0, '0');
      nb = String(preset.pattern).replace(/\{(n|name|ext|i)\}/g, (m, k) =>
        k === 'n' ? n : k === 'name' ? base : k === 'ext' ? ext.slice(1) : String(i + 1));
    } else if (preset.find) {
      try {
        if (preset.regex) nb = base.replace(new RegExp(preset.find, preset.caseSensitive ? 'g' : 'gi'), preset.replace);
        else if (preset.caseSensitive) nb = base.split(preset.find).join(preset.replace);
        else nb = base.replace(new RegExp(escapeRe(preset.find), 'gi'), () => preset.replace);
      } catch (e) { nb = base; }
    }
    return nb + ext;
  });
}

/* ------------------------------ Modal ------------------------------ */
class TextPromptModal extends Modal {
  constructor(app, title, initial, onSubmit) {
    super(app);
    this.titleText = title; this.initial = initial || ''; this.onSubmit = onSubmit;
  }
  onOpen() {
    this.titleEl.setText(this.titleText);
    const input = this.contentEl.createEl('input', { type: 'text' });
    input.value = this.initial; input.style.width = '100%';
    const submit = () => { const v = input.value.trim(); if (v) { this.close(); this.onSubmit(v); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    new Setting(this.contentEl).addButton((b) => b.setButtonText(_t("OK")).setCta().onClick(submit));
    setTimeout(() => { input.focus(); input.select(); }, 10);
  }
  onClose() { this.contentEl.empty(); }
}

class ConfirmModal extends Modal {
  constructor(app, message, onConfirm) { super(app); this.message = message; this.onConfirm = onConfirm; }
  onOpen() {
    this.titleEl.setText(_t("Please confirm"));
    this.contentEl.createEl('p', { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(_t("Cancel")).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(_t("OK")).setWarning().onClick(() => { this.close(); this.onConfirm(); }));
  }
  onClose() { this.contentEl.empty(); }
}

class AddToZoneModal extends Modal {
  constructor(app, plugin, files) { super(app); this.plugin = plugin; this.files = files; }
  onOpen() {
    const p = this.plugin, s = p.settings, el = this.contentEl;
    this.titleEl.setText(_t("Add to focus zone"));
    let zoneId = s.zones.some((z) => z.id === s.activeZone) ? s.activeZone : (s.zones[0] ? s.zones[0].id : '__new__');
    let newName = '', mode = 'all';
    const hasFolder = this.files.some((f) => f instanceof TFolder);
    let nameSetting;
    new Setting(el).setName(_t("Focus zone")).addDropdown((d) => {
      s.zones.forEach((z) => d.addOption(z.id, z.name));
      d.addOption('__new__', _t("+ New focus zone…"));
      d.setValue(zoneId);
      d.onChange((v) => { zoneId = v; nameSetting.settingEl.style.display = v === '__new__' ? '' : 'none'; });
    });
    nameSetting = new Setting(el).setName(_t("New focus zone name")).addText((t) => t.onChange((v) => (newName = v)));
    nameSetting.settingEl.style.display = zoneId === '__new__' ? '' : 'none';
    if (hasFolder) {
      new Setting(el).setName(_t("Folder scope")).addDropdown((d) => {
        d.addOption('all', _t("Include all files and subfolders"));
        d.addOption('level', _t("Current level files only"));
        d.setValue(mode);
        d.onChange((v) => (mode = v));
      });
    }
    new Setting(el).addButton((b) => b.setButtonText(_t("Add")).setCta().onClick(async () => {
      if (zoneId === '__new__') {
        const nm = newName.trim();
        if (!nm) { new Notice(_t("Please enter a focus zone name")); return; }
        zoneId = p.createZone(nm);
      }
      await p.addToZone(zoneId, this.files, mode);
      this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

class BatchRenameModal extends Modal {
  constructor(app, plugin, files) {
    super(app);
    this.plugin = plugin; this.files = files;
    const ps = plugin.settings.renamePresets;
    this.preset = clone(ps[0] || DEFAULT_PRESETS()[0]);
    this.plan = []; this.problem = '';
  }
  onOpen() {
    const p = this.plugin, el = this.contentEl;
    this.modalEl.addClass('ffm-batch-modal');
    this.updateTitle();
    const presets = p.settings.renamePresets;
    new Setting(el).setName(_t("Preset")).setDesc(_t("Add or edit presets in the plugin settings")).addDropdown((d) => {
      presets.forEach((x, i) => d.addOption(String(i), _t(x.name)));
      d.setValue('0');
      d.onChange((v) => { this.preset = clone(presets[Number(v)]); this.renderFields(); this.renderPreview(); });
    });
    this.fieldsEl = el.createDiv();
    this.problemEl = el.createDiv({ cls: 'ffm-problem' });
    this.previewEl = el.createDiv({ cls: 'ffm-preview' });
    new Setting(el)
      .addButton((b) => b.setButtonText(_t("Cancel")).onClick(() => this.close()))
      .addButton((b) => { this.applyBtn = b; b.setButtonText(_t("Apply")).setCta().onClick(() => this.apply()); });
    this.renderFields(); this.renderPreview();
  }
  updateTitle() { this.titleEl.setText(_t("Batch rename ({0} items)", this.files.length)); }
  renderFields() {
    const el = this.fieldsEl, pr = this.preset;
    el.empty();
    const text = (name, desc, key, num) => new Setting(el).setName(name).setDesc(desc || '').addText((t) =>
      t.setValue(String(pr[key])).onChange((v) => { pr[key] = num ? Number(v) || 0 : v; this.renderPreview(); }));
    const tog = (name, key) => new Setting(el).setName(name).addToggle((t) =>
      t.setValue(!!pr[key]).onChange((v) => { pr[key] = v; this.renderPreview(); }));
    if (pr.type === 'pattern') {
      text(_t("Name pattern"), _t("Available: {n} number, {name} original name (without extension), {ext} extension, {i} order (1,2,3…)"), 'pattern');
      text(_t("Start number"), '', 'start', true);
      text(_t("Step"), '', 'step', true);
      text(_t("Zero-padding digits"), _t("0 means no padding"), 'pad', true);
    } else {
      text(_t("Find"), '', 'find');
      text(_t("Replace with"), '', 'replace');
      tog(_t("Use regular expression"), 'regex');
      tog(_t("Case sensitive"), 'caseSensitive');
    }
  }
  renderPreview() {
    const files = this.files;
    const names = computeNewNames(files, this.preset);
    this.plan = files.map((f, i) => ({ file: f, newName: names[i], bad: '' }));
    const moving = new Set(this.plan.map((x) => x.file.path));
    const seen = new Map();
    let problem = '';
    for (const x of this.plan) {
      const dir = parentPath(x.file.path);
      const target = joinPath(dir, x.newName);
      const nm = x.newName;
      if (!nm || nm === '.' || nm === '..' || INVALID_NAME.test(x.newName.replace(/\.[^.]*$/, ''))) x.bad = _t("Invalid name");
      else if (seen.has(target)) x.bad = _t("Duplicate name");
      else if (target !== x.file.path && this.app.vault.getAbstractFileByPath(target) && !moving.has(target)) x.bad = _t("An item with the same name already exists");
      seen.set(target, true);
      if (x.bad && !problem) problem = _t("\"{0}\" → \"{1}\": {2}", x.file.name, x.newName, x.bad);
    }
    if (!files.length) problem = _t("No items to rename");
    this.problem = problem;
    this.problemEl.setText(problem);
    if (this.applyBtn) this.applyBtn.setDisabled(!!problem);
    const el = this.previewEl; el.empty();
    const table = el.createEl('table');
    for (const item of this.plan) {
      const tr = table.createEl('tr');
      if (item.bad) tr.addClass('is-bad');
      tr.createEl('td', { text: item.file.name });
      tr.createEl('td', { text: '→' });
      tr.createEl('td', { text: item.newName });
      const xb = tr.createEl('td').createEl('button', { cls: 'ffm-x', text: '✕' });
      xb.setAttr('aria-label', _t("Remove from this batch rename"));
      xb.onclick = () => {
        this.files = this.files.filter((f) => f !== item.file);
        this.updateTitle();
        this.renderPreview();
      };
    }
  }
  async apply() {
    if (this.problem) return;
    const fm = this.app.fileManager;
    const changes = this.plan.filter((x) => x.newName !== x.file.name);
    if (!changes.length) { this.close(); return; }
    const oldPaths = new Set(changes.map((x) => x.file.path));
    const needTemp = changes.some((x) => oldPaths.has(joinPath(parentPath(x.file.path), x.newName)));
    try {
      if (needTemp) {
        for (const x of changes) await fm.renameFile(x.file, joinPath(parentPath(x.file.path), `__ffm_tmp_${uid()}_${x.file.name}`));
      }
      for (const x of changes) await fm.renameFile(x.file, joinPath(parentPath(x.file.path), x.newName));
      new Notice(_t("Renamed {0} items", changes.length));
    } catch (e) {
      console.error(e); new Notice(_t("Rename failed: ") + e.message);
    }
    this.close();
    this.plugin.refreshAll();
  }
  onClose() { this.contentEl.empty(); }
}

class IconPickerModal extends Modal {
  constructor(app, plugin, current, onPick) { super(app); this.plugin = plugin; this.current = current; this.onPick = onPick; }
  onOpen() {
    this.titleEl.setText(_t("Choose icon"));
    this.modalEl.addClass('ffm-icon-modal');
    buildIconGrid(this.contentEl.createDiv(), (name) => { this.close(); this.onPick(name); }, this.current);
  }
  onClose() { this.contentEl.empty(); }
}

class StyleModal extends Modal {
  constructor(app, plugin, files) { super(app); this.plugin = plugin; this.files = files; }
  onOpen() {
    const p = this.plugin, s = p.settings, el = this.contentEl;
    this.modalEl.addClass('ffm-icon-modal');
    this.titleEl.setText(_t("Appearance ({0} items)", this.files.length));
    const cur = Object.assign({ icon: '', color: '', bg: '', bgAlpha: 100 }, s.styles[this.files[0].path] || {});
    if (cur.bgAlpha === undefined || cur.bgAlpha === null || cur.bgAlpha === '') cur.bgAlpha = 100;
    el.createEl('p', { cls: 'setting-item-description', text: _t("Click an icon or template below to apply it immediately. You can also type a Lucide name, an icon ID registered by another plugin, or an emoji. Colors accept names (red), RGB (255,0,0) or HEX (#FF0000).") });
    const persist = async (close) => {
      this.files.forEach((f) => {
        if (cur.icon || cur.color || cur.bg) s.styles[f.path] = { icon: cur.icon, color: cur.color, bg: cur.bg, bgAlpha: cur.bgAlpha };
        else delete s.styles[f.path];
      });
      await p.saveSettings(); p.refreshAll();
      if (close) this.close();
    };
    let iconComp, colorComp, bgComp, alphaComp, preview;
    const upd = () => p.setAnyIcon(preview, cur.icon);
    const syncFields = () => {
      iconComp.setValue(cur.icon || ''); colorComp.setValue(cur.color || ''); bgComp.setValue(cur.bg || ''); alphaComp.setValue(Number(cur.bgAlpha));
      upd();
    };
    // ---- 我的模板（可儲存多個）
    const tplHost = el.createDiv({ cls: 'ffm-tpl-host' });
    const renderTpls = () => {
      tplHost.empty();
      const row = tplHost.createDiv({ cls: 'ffm-tpl-row' });
      row.createSpan({ cls: 'ffm-tpl-label', text: _t("My templates") });
      if (!s.styleTemplates.length) row.createSpan({ cls: 'ffm-tpl-label', text: _t("(No templates saved yet)") });
      s.styleTemplates.forEach((tp, i) => {
        const chip = row.createDiv({ cls: 'ffm-tpl-chip' });
        chip.setAttr('aria-label', _t("Click to apply this template"));
        const ic = chip.createSpan({ cls: 'ffm-tpl-icon' });
        p.setAnyIcon(ic, tp.icon);
        const nm = chip.createSpan({ text: tp.name });
        if (tp.color) { const c = parseColor(tp.color, p.aliasMap); ic.style.color = c; nm.style.color = c; }
        if (tp.bg) {
          const bc = parseColor(tp.bg, p.aliasMap), al = tp.bgAlpha === undefined ? 100 : Number(tp.bgAlpha);
          chip.style.background = al >= 100 ? bc : `color-mix(in srgb, ${bc} ${al}%, transparent)`;
        }
        chip.onclick = async () => {
          cur.icon = tp.icon || ''; cur.color = tp.color || ''; cur.bg = tp.bg || '';
          cur.bgAlpha = tp.bgAlpha === undefined ? 100 : tp.bgAlpha;
          syncFields();
          await persist(false);
        };
        const x = chip.createSpan({ cls: 'ffm-tpl-x', text: '✕' });
        x.setAttr('aria-label', _t("Delete this template"));
        x.onclick = async (e) => { e.stopPropagation(); s.styleTemplates.splice(i, 1); await p.saveSettings(); renderTpls(); };
      });
      const save = row.createEl('button', { cls: 'ffm-btn', text: _t("+ Save current settings as template") });
      save.onclick = () => new TextPromptModal(p.app, _t("Template name"), '', async (name) => {
        const entry = { name, icon: cur.icon, color: cur.color, bg: cur.bg, bgAlpha: cur.bgAlpha };
        const k = s.styleTemplates.findIndex((x2) => x2.name === name);
        if (k >= 0) s.styleTemplates[k] = entry; else s.styleTemplates.push(entry);
        await p.saveSettings(); renderTpls();
        new Notice(_t("Saved template \"{0}\"", name));
      }).open();
    };
    renderTpls();
    // ---- 圖示
    const iconSetting = new Setting(el).setName(_t("Icon"));
    iconSetting.addText((t2) => { iconComp = t2; t2.setPlaceholder(_t("Icon name / emoji")).setValue(cur.icon).onChange((v) => { cur.icon = v.trim(); upd(); }); });
    preview = iconSetting.controlEl.createSpan({ cls: 'ffm-mark-preview' });
    upd();
    buildIconGrid(el.createDiv({ cls: 'ffm-icon-host' }), async (name) => { cur.icon = name; iconComp.setValue(name); upd(); await persist(false); }, cur.icon);
    new Setting(el).setName(_t("Text color")).addText((t2) => { colorComp = t2; t2.setValue(cur.color).onChange((v) => (cur.color = v.trim())); });
    new Setting(el).setName(_t("Background color")).addText((t2) => { bgComp = t2; t2.setValue(cur.bg).onChange((v) => (cur.bg = v.trim())); });
    new Setting(el).setName(_t("Background opacity")).setDesc(_t("100 = opaque; lower values are more transparent"))
      .addSlider((sl) => { alphaComp = sl; sl.setLimits(0, 100, 5).setValue(Number(cur.bgAlpha)).setDynamicTooltip().onChange((v) => (cur.bgAlpha = v)); });
    new Setting(el)
      .addButton((b) => b.setButtonText(_t("Clear appearance")).onClick(async () => {
        this.files.forEach((f) => delete s.styles[f.path]);
        await p.saveSettings(); p.refreshAll(); this.close();
      }))
      .addButton((b) => b.setButtonText(_t("Apply")).setCta().onClick(() => persist(true)));
  }
  onClose() { this.contentEl.empty(); }
}

class PropertiesModal extends Modal {
  constructor(app, plugin, files) { super(app); this.plugin = plugin; this.files = files; }
  async onOpen() {
    const p = this.plugin, el = this.contentEl;
    this.titleEl.setText(_t("Properties"));
    const table = el.createEl('table', { cls: 'ffm-props' });
    const row = (k, v) => { const tr = table.createEl('tr'); tr.createEl('td', { cls: 'ffm-props-k', text: k }); tr.createEl('td', { text: String(v) }); };
    const sizeOf = (f) => (f instanceof TFolder ? f.children.reduce((a, c) => a + sizeOf(c), 0) : f.stat.size);
    const count = (f, acc) => { f.children.forEach((c) => { if (c instanceof TFolder) { acc.dirs++; count(c, acc); } else acc.files++; }); return acc; };
    if (this.files.length === 1) {
      const f = this.files[0], isF = f instanceof TFolder;
      row(_t("Name"), f.name || '/');
      row(_t("Path"), f.path || '/');
      row(_t("Type"), isF ? _t("Folders") : _t("Files"));
      if (!isF && f.extension) row(_t("Extension"), f.extension);
      row(_t("Size"), p.fmtSize(sizeOf(f)));
      if (isF) { const c = count(f, { files: 0, dirs: 0 }); row(_t("Contents"), _t("{0} files, {1} subfolders (including all levels)", c.files, c.dirs)); }
      let st = isF ? null : f.stat;
      if (isF) { try { st = await p.app.vault.adapter.stat(f.path); } catch (e) { st = null; } }
      if (st) { row(_t("Created"), fmtDate(st.ctime)); row(_t("Last modified"), fmtDate(st.mtime)); }
    } else {
      const folders = this.files.filter((f) => f instanceof TFolder).length;
      row(_t("Selected"), _t("{0} items ({1} folders, {2} files)", this.files.length, folders, this.files.length - folders));
      row(_t("Total size"), p.fmtSize(pruneNested(this.files).reduce((a, f) => a + sizeOf(f), 0)));
    }
  }
  onClose() { this.contentEl.empty(); }
}

/* ------------------------------ 樹狀面板 ------------------------------ */
class Pane {
  constructor(plugin, el, cfg) {
    this.plugin = plugin; this.el = el; this.cfg = cfg;
    this.selection = new Set(); this.lastClicked = null;
    this.rows = []; this.roots = new Set();
    this.selectMode = false; this.suppressClickUntil = 0;
    this.bmSet = new Set(); this.pinSet = new Set();
    el.tabIndex = 0;
    el.addEventListener('keydown', (e) => this.onKey(e));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showBlankMenu(e); });
    el.addEventListener('mousedown', () => { if (cfg.onActivate) cfg.onActivate(this); }, true);
    if (cfg.pathBarEl) cfg.pathBarEl.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showPathMenu(e, plugin.nav.path); });
    el.addEventListener('mouseup', (e) => {
      if (!this.isExplorer()) return;
      if (e.button === 3) { e.preventDefault(); plugin.navBack(); }
      else if (e.button === 4) { e.preventDefault(); plugin.navForward(); }
    });
    el.addEventListener('touchstart', () => { if (cfg.onActivate) cfg.onActivate(this); }, { capture: true, passive: true });
    el.addEventListener('dragover', (e) => {
      if (!plugin.dragFiles) return;
      e.preventDefault();
      if (plugin.dragPane && plugin.dragPane !== this) el.addClass('is-drop-target');
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.removeClass('is-drop-target'); });
    el.addEventListener('drop', async (e) => {
      if (!plugin.dragFiles) return;
      e.preventDefault();
      const f = plugin.dragFiles, src = plugin.dragPane;
      plugin.dragFiles = null; plugin.dragPane = null; plugin.clearDropMarks();
      if (src && src !== this) await plugin.crossPaneDrop(src, this, f);
      else if (!cfg.isZone) await plugin.handleDrop(f, plugin.treeBaseFolder(), 'inside');
      else await plugin.zoneMoveToGroup(f, null);
    });
  }

  isExplorer() { return !this.cfg.isZone && this.plugin.settings.treeStyle === 'explorer'; }
  expandedMap() {
    const k = this.cfg.key();
    const ex = this.plugin.settings.expanded;
    if (!ex[k]) ex[k] = {};
    return ex[k];
  }
  isExpanded(path) { return !!this.expandedMap()[path]; }
  toggleExpanded(path) {
    const m = this.expandedMap();
    if (m[path]) delete m[path]; else m[path] = true;
    this.plugin.saveSoon();
    this.plugin.views.forEach((v) => v.updateToolbar());
  }
  collapseAll() {
    const prev = this.expandedMap(), ex = this.plugin.excludeMatcher();
    const m = {};
    for (const k of Object.keys(prev)) if (ex.under(k)) m[k] = prev[k];
    this.plugin.settings.expanded[this.cfg.key()] = m;
    this.plugin.saveSoon();
    this.render();
  }
  expandAll() {
    const prev = this.expandedMap(), ex = this.plugin.excludeMatcher();
    const m = {};
    const walk = (f) => {
      if (!(f instanceof TFolder)) return;
      if (ex.match(f.path)) {
        for (const k of Object.keys(prev)) if (k === f.path || k.startsWith(f.path + '/')) m[k] = prev[k];
        return;
      }
      m[f.path] = true;
      f.children.forEach(walk);
    };
    this.cfg.getRoots().forEach((r) => walk(r.file));
    if (this.cfg.isZone) {
      const z = this.plugin.activeZoneObj();
      if (z) z.items.forEach((g) => { if (g.group) m['ffm-group:' + g.id] = true; });
    }
    this.plugin.settings.expanded[this.cfg.key()] = m;
    this.plugin.saveSoon();
    this.render();
  }

  render() {
    const p = this.plugin, s = p.settings;
    const scroll = this.el.scrollTop;
    this.el.empty();
    this.el.toggleClass('nav-files-container', s.nativeClasses !== false);
    this.el.toggleClass('ffm-guides', s.indentGuides !== false);
    this.el.toggleClass('ffm-explorer', this.isExplorer());
    this.el.toggleClass('ffm-nowrap-full', s.fullNameWrap === false && !!(s.fullNameFolder || s.fullNameFile));
    const gw = Math.max(1, Number(s.guideWidth) || 1), go = Math.max(5, Number(s.guideOpacity) || 100);
    this.el.style.setProperty('--ffm-guide-width', gw + 'px');
    this.el.style.setProperty('--ffm-guide-opacity', go + '%');
    [['open', 'open'], ['tab', 'tab']].forEach(([k, v]) => {
      const col = s[k + 'IconColor'];
      if (col) this.el.style.setProperty('--ffm-' + v + '-color', parseColor(col, p.aliasMap));
      else this.el.style.removeProperty('--ffm-' + v + '-color');
      this.el.style.setProperty('--ffm-' + v + '-opacity', String(Math.max(0.1, (Number(s[k + 'IconOpacity']) || 100) / 100)));
    });
    this.el.style.setProperty('--ffm-guide-line', GUIDE_LINES.includes(s.guideLine) ? s.guideLine : 'solid');
    this.el.style.setProperty('--ffm-guide-offset', (s.guideOffset === undefined ? 12 : Number(s.guideOffset) || 0) + 'px');
    this.el.style.setProperty('--nav-indentation-guide-width', s.indentGuides === false ? '0px' : gw + 'px');
    if (s.guideColor) this.el.style.setProperty('--ffm-guide-color', parseColor(s.guideColor, p.aliasMap));
    else this.el.style.removeProperty('--ffm-guide-color');
    if (this.cfg.pathBarEl) this.renderPathBar();
    // 偵測主題是否自己畫了資料夾／檔案圖示、是否隱藏了展開符號（例如 Rathgar Gold）
    const th = this.detectTheme();
    const imode = s.iconSource || 'auto';
    this.ownIcons = imode === 'plugin' || (imode === 'auto' && !th.icons);
    this.noThemeIcons = imode === 'plugin';
    const amode = s.arrowMode || 'auto';
    this.el.toggleClass('ffm-hide-arrow', amode === 'hide' || (amode === 'auto' && th.arrowHidden && !s.folderArrowOnly));
    this.el.style.setProperty('--ffm-dim', String((Number(s.dimOpacity) || 35) / 100));
    this.rows = [];
    this.bmSet = s.showBookmarkMark !== false ? p.bookmarkPaths() : new Set();
    this.pinSet = new Set(s.pinned);
    if (this.cfg.isZone) {
      const z = p.activeZoneObj();
      if (z) p.allZoneItems(z).forEach((i) => { if (i.pinned) this.pinSet.add(i.path); });
    }
    const roots = this.cfg.getRoots();
    this.roots = new Set(roots.map((r) => r.file.path));
    if (this.selectMode) this.renderSelBar();
    const entries = this.cfg.getEntries ? this.cfg.getEntries() : roots.map((r) => ({ kind: 'item', file: r.file, levelOnly: r.levelOnly }));
    for (const en of entries) {
      if (en.kind === 'group') this.renderGroup(this.el, en);
      else this.renderNode(this.el, en.file, 0, en.levelOnly);
    }
    if (!entries.length) {
      const t = this.cfg.emptyText();
      if (t) this.el.createDiv({ cls: 'ffm-empty', text: t });
    }
    this.el.createDiv({ cls: 'ffm-spacer' });
    this.el.scrollTop = scroll;
  }

  detectTheme() {
    const res = { icons: false, arrowHidden: false };
    if (this.plugin.settings.nativeClasses === false) return res;
    try {
      const probe = this.el.createDiv({ cls: ['nav-folder', 'ffm-probe'] });
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
      const row = probe.createDiv({ cls: ['tree-item-self', 'nav-folder-title'] });
      const c = row.createSpan({ cls: ['tree-item-inner', 'nav-folder-title-content'] });
      const a = row.createSpan({ cls: ['tree-item-icon', 'collapse-icon'] });
      const content = getComputedStyle(c, '::before').content;
      res.icons = !!content && content !== 'none' && content !== 'normal';
      res.arrowHidden = getComputedStyle(a).display === 'none';
      probe.remove();
    } catch (e) { /* ignore */ }
    return res;
  }

  /* ---- 電腦式：路徑列 ---- */
  renderPathBar() {
    const p = this.plugin, s = p.settings, bar = this.cfg.pathBarEl;
    bar.empty();
    const on = this.isExplorer();
    bar.style.display = on ? '' : 'none';
    if (!on) return;
    const nav = p.nav;
    const mk = (icon, tip, fn, disabled) => {
      const b = bar.createDiv({ cls: ['clickable-icon', 'ffm-ibtn'] });
      setIcon(b, icon); b.setAttr('aria-label', tip);
      if (disabled) b.addClass('is-disabled'); else b.onclick = fn;
    };
    mk('arrow-left', _t("Back"), () => p.navBack(), !nav.back.length);
    mk('arrow-right', _t("Forward"), () => p.navForward(), !nav.fwd.length);
    mk('arrow-up', _t("Up one level"), () => p.navUp(), nav.path === '/');
    const crumbs = bar.createDiv({ cls: 'ffm-crumbs' });
    const segs = [{ name: p.app.vault.getName(), path: '/' }];
    let acc = '';
    (nav.path === '/' ? [] : nav.path.split('/')).forEach((part) => { acc = acc ? acc + '/' + part : part; segs.push({ name: part, path: acc }); });
    segs.forEach((sg, i) => {
      if (i) crumbs.createSpan({ cls: 'ffm-crumb-sep', text: '›' });
      const c = crumbs.createSpan({ cls: 'ffm-crumb', text: sg.name });
      c.onclick = () => p.navigate(sg.path);
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.showPathMenu(e, sg.path); });
      c.addEventListener('dragover', (e) => { if (!p.dragFiles) return; e.preventDefault(); e.stopPropagation(); c.addClass('drop-inside'); });
      c.addEventListener('dragleave', () => c.removeClass('drop-inside'));
      c.addEventListener('drop', async (e) => {
        if (!p.dragFiles) return;
        e.preventDefault(); e.stopPropagation();
        const files = p.dragFiles;
        p.dragFiles = null; p.dragPane = null; p.clearDropMarks(); c.removeClass('drop-inside');
        const dest = sg.path === '/' ? p.app.vault.getRoot() : p.app.vault.getAbstractFileByPath(sg.path);
        if (!(dest instanceof TFolder)) return;
        if (!s.crossLevelMove) { new Notice(_t("\"Cross-level move\" is off; cannot move to another level")); return; }
        await p.moveFiles(files, dest); p.refreshAll();
      });
    });
    crumbs.scrollLeft = crumbs.scrollWidth;
  }
  showPathMenu(e, path) {
    const p = this.plugin, m = new Menu();
    const copy = async (text) => { try { await navigator.clipboard.writeText(text); new Notice(_t("Path copied")); } catch (err) { new Notice(_t("Copy failed")); } };
    m.addItem((i) => i.setTitle(_t("Copy path")).setIcon('link').onClick(() => copy(path)));
    if (HAS_NODE && p.basePath()) m.addItem((i) => i.setTitle(_t("Copy full path")).setIcon('link-2').onClick(() => copy(path === '/' ? p.basePath() : nodePath.join(p.basePath(), path))));
    m.showAtMouseEvent(e);
  }

  /* ---- 選取模式 ---- */
  renderSelBar() {
    const bar = this.el.createDiv({ cls: 'ffm-selbar' });
    bar.createSpan({ cls: 'ffm-selbar-text', text: _t("Selection mode ({0} selected)", this.selection.size) });
    const all = bar.createEl('button', { cls: 'ffm-btn', text: _t("Select all") });
    all.onclick = () => { this.selectAll(); };
    const done = bar.createEl('button', { cls: 'ffm-btn', text: _t("Done") });
    done.onclick = () => this.exitSelectMode();
  }
  enterSelectMode(path) {
    this.selectMode = true;
    if (path) { this.selection = new Set([path]); this.lastClicked = path; }
    this.render();
  }
  exitSelectMode() {
    this.selectMode = false;
    this.selection = new Set();
    this.render();
  }
  onSwipeRight(file) {
    const path = file.path;
    if (!this.selectMode) { this.enterSelectMode(path); return; }
    const paths = this.rows.map((f) => f.path);
    const a = paths.indexOf(this.lastClicked), b = paths.indexOf(path);
    if (a < 0 || b < 0) this.selection.add(path);
    else {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      paths.slice(lo, hi + 1).forEach((x) => this.selection.add(x));
    }
    this.lastClicked = path;
    this.updateSelection();
  }

  /* ---- 專注區臨時文件夾（虛擬） ---- */
  renderGroup(parentEl, en) {
    const p = this.plugin, s = p.settings, g = en.group;
    const nat = s.nativeClasses !== false;
    const gk = 'ffm-group:' + g.id;
    const expanded = this.isExpanded(gk);
    const node = parentEl.createDiv({ cls: nat ? ['ffm-node', 'tree-item', 'nav-folder'].concat(expanded ? [] : ['is-collapsed']) : 'ffm-node' });
    const row = node.createDiv({ cls: nat ? ['ffm-row', 'ffm-group-row', 'tree-item-self', 'nav-folder-title', 'is-clickable', 'mod-collapsible'] : ['ffm-row', 'ffm-group-row'] });
    row.dataset.group = g.id;
    p.setAnyIcon(row.createSpan({ cls: 'ffm-arrow' }), expanded ? s.icons.expanded : s.icons.collapsed);
    row.createSpan({ cls: 'ffm-indicator' });
    if (this.ownIcons && s.showFolderIcon) p.setAnyIcon(row.createSpan({ cls: 'ffm-icon' }), expanded ? s.icons.folderOpen : s.icons.folder);
    const gcls = nat ? ['ffm-name', 'tree-item-inner', 'nav-folder-title-content'] : ['ffm-name'];
    if (this.noThemeIcons || !s.showFolderIcon) gcls.push('ffm-no-theme-icon');
    row.createSpan({ cls: gcls, text: g.name });
    row.createSpan({ cls: 'ffm-tag', text: _t("Temp · {0}", en.children.length) });

    row.addEventListener('click', () => {
      if (Date.now() < this.suppressClickUntil) return;
      this.toggleExpanded(gk); this.render();
    });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.showGroupMenu(e, g); });
    row.addEventListener('dragover', (e) => {
      if (!p.dragFiles) return;
      e.preventDefault(); e.stopPropagation();
      p.markDrop(row, 'inside');
    });
    row.addEventListener('dragleave', () => row.removeClasses(['drop-inside']));
    row.addEventListener('drop', async (e) => {
      if (!p.dragFiles) return;
      e.preventDefault(); e.stopPropagation();
      const files = p.dragFiles, src = p.dragPane;
      p.dragFiles = null; p.dragPane = null; p.clearDropMarks();
      if (src === this) await p.zoneMoveToGroup(files, g.id);
      else if (src && !src.cfg.isZone) {
        const z = p.activeZoneObj();
        if (z) await p.addToZone(z.id, files, s.dragAddMode || 'all', g.id);
      }
    });

    if (expanded) {
      const kids = node.createDiv({ cls: nat ? ['ffm-children', 'tree-item-children', 'nav-folder-children'] : 'ffm-children' });
      en.children.forEach((c) => this.renderNode(kids, c.file, 1, c.levelOnly));
    }
  }

  /* ---- 一般項目 ---- */
  renderNode(parentEl, file, depth, levelOnly) {
    const p = this.plugin, s = p.settings;
    const folder = file instanceof TFolder;
    const nat = s.nativeClasses !== false;
    const explorer = this.isExplorer();
    const expanded = folder && !explorer && this.isExpanded(file.path);
    const node = parentEl.createDiv({ cls: nat ? ['ffm-node', 'tree-item', folder ? 'nav-folder' : 'nav-file'].concat(folder && !expanded ? ['is-collapsed'] : []) : 'ffm-node' });
    const row = node.createDiv({ cls: nat ? ['ffm-row', 'tree-item-self', folder ? 'nav-folder-title' : 'nav-file-title', 'is-clickable'].concat(folder ? ['mod-collapsible'] : []) : 'ffm-row' });
    row.dataset.path = file.path;
    row.draggable = Platform.isDesktop;
    if (!folder && p.activePath === file.path) row.addClass('is-active');
    if (this.selection.has(file.path)) row.addClass('is-selected');
    if (p.cutPaths.has(file.path)) row.addClass('is-cut');

    const arrow = row.createSpan({ cls: 'ffm-arrow' });
    if (folder) p.setAnyIcon(arrow, expanded ? s.icons.expanded : s.icons.collapsed);
    p.applyIndicator(row.createSpan({ cls: 'ffm-indicator' }), file);
    const st = s.styles[file.path] || null;
    const customIcon = !!(st && st.icon);
    const showKind = folder ? s.showFolderIcon : s.showFileIcon;
    if (customIcon || (this.ownIcons && showKind)) {
      const spec = (st && st.icon) || (folder ? (expanded ? s.icons.folderOpen : s.icons.folder) : p.extIcon(file) || s.icons.file);
      p.setAnyIcon(row.createSpan({ cls: 'ffm-icon' }), spec);
    }
    const layout = s.metaLayout || 'inline';
    const textEl = row.createDiv({ cls: 'ffm-text' });
    const line1 = textEl.createDiv({ cls: 'ffm-line1' });
    const nameCls = ['ffm-name'];
    if (nat) nameCls.push('tree-item-inner', folder ? 'nav-folder-title-content' : 'nav-file-title-content');
    if (folder ? s.fullNameFolder : s.fullNameFile) nameCls.push('ffm-name-full', ...(s.fullNameWrap === false ? ['ffm-nowrap'] : []));
    if (customIcon || this.noThemeIcons || !showKind) nameCls.push('ffm-no-theme-icon');
    const nameEl = line1.createSpan({ cls: nameCls, text: folder ? file.name : file.basename });
    if (st && st.color) nameEl.style.color = parseColor(st.color, p.aliasMap);
    if (st && st.bg) {
      const bc = parseColor(st.bg, p.aliasMap);
      const al = st.bgAlpha === undefined || st.bgAlpha === null ? 100 : Number(st.bgAlpha);
      row.style.setProperty('--ffm-row-bg', al >= 100 ? bc : `color-mix(in srgb, ${bc} ${al}%, transparent)`);
    }

    const pinned = this.pinSet.has(file.path), bookmarked = this.bmSet.has(file.path);
    if (pinned || bookmarked) {
      const marks = line1.createSpan({ cls: 'ffm-marks' });
      if (pinned) {
        const pm = marks.createSpan({ cls: 'ffm-pin' });
        p.setAnyIcon(pm, s.pinIcon || 'pin'); pm.setAttr('aria-label', _t("Pin to top"));
      }
      if (bookmarked) {
        const bm = marks.createSpan({ cls: 'ffm-bm' });
        p.setAnyIcon(bm, s.bookmarkIcon || 'bookmark'); bm.setAttr('aria-label', _t("Bookmarked"));
      }
    }

    const inlineM = [], belowM = [];
    if (folder) {
      if (s.show.folderFileCount || s.show.folderSubCount) {
        const c = p.countInfo(file);
        const dst = layout === 'inline' ? inlineM : belowM;
        if (s.show.folderFileCount) dst.push(_t("{0} files", c.files));
        if (s.show.folderSubCount) dst.push(_t("{0} folders", c.dirs));
      }
    } else {
      if (s.show.extension) {
        if (layout === 'below') belowM.push('.' + file.extension);
        else inlineM.push(file.extension);
      }
      const dst = layout === 'inline' ? inlineM : belowM;
      if (s.show.ctime) dst.push(fmtDate(file.stat.ctime));
      if (s.show.size) dst.push(p.fmtSize(file.stat.size));
    }
    if (inlineM.length) {
      const m = line1.createSpan({ cls: 'ffm-meta' });
      inlineM.forEach((x) => m.createSpan({ text: x }));
    }
    if (belowM.length) {
      const m = textEl.createDiv({ cls: 'ffm-line2' });
      belowM.forEach((x) => m.createSpan({ text: x }));
    }
    if (!folder && s.openViaButton) {
      const box = row.createSpan({ cls: 'ffm-open' });
      const mk = (icon, tip, how) => {
        const btn = box.createSpan({ cls: ['ffm-open-btn', how === 'tab' ? 'ffm-open-tab' : 'ffm-open-main'] });
        setIcon(btn, pickIcon(icon));
        btn.setAttr('aria-label', tip);
        btn.addEventListener('click', (e) => { e.stopPropagation(); p.openFile(file, how); });
      };
      if (s.openMode === 'tab') mk('external-link', p.tabLabel(), 'tab');
      else {
        mk('external-link', _t("Open"), 'current');
        if (s.showTabButton !== false) mk('square-plus|plus-square', p.tabLabel(), 'tab');
      }
    }

    // 滑鼠停留：顯示最後修改／建立時間
    if (s.hoverInfo !== false && Platform.isDesktop) {
      if (!folder) {
        row.setAttr('aria-label', p.timeTip(file.stat));
        row.addEventListener('mouseenter', () => row.setAttr('aria-label', p.timeTip(file.stat)));
      } else {
        row.addEventListener('mouseenter', async () => {
          try {
            const st2 = await p.app.vault.adapter.stat(file.path);
            if (st2) row.setAttr('aria-label', p.timeTip(st2));
          } catch (e) { /* ignore */ }
        });
      }
    }
    this.rows.push(file);

    row.addEventListener('click', (e) => this.onClick(e, file));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!this.selection.has(file.path)) { this.selection = new Set([file.path]); this.lastClicked = file.path; this.updateSelection(); }
      this.showMenu(e, file);
    });

    // 手機：向右滑動 → 進入選取模式／選取到此為止的範圍
    let tx = 0, ty = 0, swiped = false;
    row.addEventListener('touchstart', (e) => { const t = e.touches[0]; tx = t.clientX; ty = t.clientY; swiped = false; }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      if (swiped) return;
      const t = e.touches[0];
      if (t.clientX - tx > 50 && Math.abs(t.clientY - ty) < 30) {
        swiped = true;
        this.suppressClickUntil = Date.now() + 500;
        this.onSwipeRight(file);
      }
    }, { passive: true });

    row.addEventListener('dragstart', (e) => {
      if (!this.selection.has(file.path)) { this.selection = new Set([file.path]); this.updateSelection(); }
      p.dragFiles = pruneNested(this.getSelectedFiles());
      p.dragPane = this;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', p.dragFiles.map((f) => f.path).join('\n'));
      if (!s.crossLevelMove && s.dimOtherLevels !== false) {
        const dragged = p.dragFiles;
        setTimeout(() => this.dimOtherLevels(dragged), 0);
      }
    });
    row.addEventListener('dragend', () => { p.dragFiles = null; p.dragPane = null; p.clearDropMarks(); });
    row.addEventListener('dragover', (e) => {
      if (!p.dragFiles) return;
      e.preventDefault(); e.stopPropagation();
      if (p.dragPane && p.dragPane !== this) { this.el.addClass('is-drop-target'); return; }
      p.markDrop(row, this.dropPos(e, row, folder));
    });
    row.addEventListener('dragleave', () => row.removeClasses(['drop-inside', 'drop-before', 'drop-after']));
    row.addEventListener('drop', async (e) => {
      if (!p.dragFiles) return;
      e.preventDefault(); e.stopPropagation();
      const pos = this.dropPos(e, row, folder);
      const files = p.dragFiles, src = p.dragPane;
      p.dragFiles = null; p.dragPane = null; p.clearDropMarks();
      if (src && src !== this) await p.crossPaneDrop(src, this, files);
      else await p.handleDrop(files, file, pos);
    });

    if (folder && expanded) {
      const kids = node.createDiv({ cls: nat ? ['ffm-children', 'tree-item-children', 'nav-folder-children'] : 'ffm-children' });
      for (const kid of p.getChildren(file, levelOnly)) this.renderNode(kids, kid, depth + 1, false);
    }
  }

  dropPos(e, row, folder) {
    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (folder && y > 0.25 && y < 0.75) return 'inside';
    return y < 0.5 ? 'before' : 'after';
  }

  // 跨層級移動關閉時：拖曳期間把其他層級的項目變灰
  dimOtherLevels(files) {
    const vault = this.plugin.app.vault;
    const parents = new Set(files.map((f) => (f.parent ? f.parent.path : '/')));
    this.el.querySelectorAll('.ffm-row').forEach((r) => {
      if (!r.dataset.path) return;
      const f = vault.getAbstractFileByPath(r.dataset.path);
      if (!f) return;
      r.toggleClass('is-dimmed', !parents.has(f.parent ? f.parent.path : '/'));
    });
  }

  onClick(e, file) {
    if (Date.now() < this.suppressClickUntil) return;
    const path = file.path, p = this.plugin, s = p.settings;
    const folder = file instanceof TFolder;
    const mod = e.shiftKey || e.ctrlKey || e.metaKey;
    if (this.openTimer) { clearTimeout(this.openTimer); this.openTimer = null; }

    // 點資料夾旁邊的符號：只展開／收合
    if (folder && !mod && e.target.closest && e.target.closest('.ffm-arrow')) {
      this.lastClick = null;
      this.toggleExpanded(path); this.render();
      return;
    }

    // 選取模式：點擊 = 切換選取
    if (this.selectMode && !e.shiftKey) {
      if (this.selection.has(path)) this.selection.delete(path); else this.selection.add(path);
      this.lastClicked = path;
      this.updateSelection();
      if (!this.selection.size) this.exitSelectMode();
      return;
    }

    // 自行判斷雙擊：第二下 → 重新命名（第一下的「開啟」會被延遲而取消）
    const now = Date.now(), win = Number(s.doubleClickMs) || 300;
    if (!mod && this.lastClick && this.lastClick.path === path && now - this.lastClick.t < win) {
      this.lastClick = null;
      if (folder && this.lastToggled === path) { this.toggleExpanded(path); this.render(); }
      this.lastToggled = null;
      this.selection = new Set([path]); this.lastClicked = path;
      this.updateSelection();
      this.startRenameByPath(path);
      return;
    }
    this.lastClick = mod ? null : { path, t: now };
    this.lastToggled = null;

    if (e.shiftKey && this.lastClicked) {
      const paths = this.rows.map((f) => f.path);
      const a = paths.indexOf(this.lastClicked), b = paths.indexOf(path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        this.selection = new Set(paths.slice(lo, hi + 1));
      }
      this.updateSelection();
    } else if (e.ctrlKey || e.metaKey) {
      if (this.selection.has(path)) this.selection.delete(path); else this.selection.add(path);
      this.lastClicked = path;
      this.updateSelection();
    } else {
      this.selection = new Set([path]);
      this.lastClicked = path;
      if (folder && this.isExplorer()) { p.navigate(path); return; }
      if (folder) {
        if (!s.folderArrowOnly) { this.toggleExpanded(path); this.lastToggled = path; this.render(); }
        else this.updateSelection();
      } else {
        this.updateSelection();
        if (!s.openViaButton) this.openTimer = setTimeout(() => { this.openTimer = null; p.openFile(file); }, win);
      }
    }
    this.el.focus();
  }

  updateSelection() {
    this.el.querySelectorAll('.ffm-row').forEach((r) => r.toggleClass('is-selected', !!r.dataset.path && this.selection.has(r.dataset.path)));
    const t = this.el.querySelector('.ffm-selbar-text');
    if (t) t.setText(_t("Selection mode ({0} selected)", this.selection.size));
  }
  updateIndicators() {
    this.el.querySelectorAll('.ffm-row').forEach((r) => {
      if (!r.dataset.path) return;
      const f = this.plugin.app.vault.getAbstractFileByPath(r.dataset.path);
      const ind = r.querySelector('.ffm-indicator');
      if (f && ind) this.plugin.applyIndicator(ind, f);
      r.toggleClass('is-active', f instanceof TFile && f.path === this.plugin.activePath);
    });
  }

  getSelectedFiles() {
    const vault = this.plugin.app.vault;
    const inRows = new Set(this.rows.map((f) => f.path));
    const ordered = this.rows.filter((f) => this.selection.has(f.path));
    const rest = [...this.selection].filter((p) => !inRows.has(p)).map((p) => vault.getAbstractFileByPath(p)).filter(Boolean);
    return [...ordered, ...rest];
  }
  selectAll() { this.selection = new Set(this.rows.map((f) => f.path)); this.updateSelection(); }
  selectEverything() {
    if (this.isExplorer()) { this.selectAll(); return; }
    const all = new Set();
    const walk = (f) => { all.add(f.path); if (f instanceof TFolder) f.children.forEach(walk); };
    this.cfg.getRoots().forEach((r) => walk(r.file));
    this.selection = all; this.updateSelection();
  }
  pasteTarget() {
    const root = this.plugin.app.vault.getRoot();
    const f = this.getSelectedFiles()[0];
    if (!f) return this.cfg.isZone ? root : this.plugin.treeBaseFolder();
    return f instanceof TFolder ? f : f.parent || root;
  }

  onKey(e) {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'c') { e.preventDefault(); this.plugin.copySelection(this, false); }
    else if (mod && k === 'x') { e.preventDefault(); this.plugin.copySelection(this, true); }
    else if (mod && k === 'v') { e.preventDefault(); this.plugin.paste(this.pasteTarget()); }
    else if (mod && k === 'a') { e.preventDefault(); this.selectAll(); }
    else if (k === 'f2') { const f = this.getSelectedFiles()[0]; if (f) this.startRenameByPath(f.path); }
    else if (this.isExplorer() && (k === 'backspace' || (e.altKey && k === 'arrowup'))) { e.preventDefault(); this.plugin.navUp(); }
    else if (this.isExplorer() && e.altKey && k === 'arrowleft') { e.preventDefault(); this.plugin.navBack(); }
    else if (this.isExplorer() && e.altKey && k === 'arrowright') { e.preventDefault(); this.plugin.navForward(); }
    else if (k === 'escape' && this.selectMode) { this.exitSelectMode(); }
  }

  startRenameByPath(path) {
    const row = [...this.el.querySelectorAll('.ffm-row')].find((r) => r.dataset.path === path);
    const f = this.plugin.app.vault.getAbstractFileByPath(path);
    if (row && f) this.startRename(f, row);
  }
  startRename(file, row) {
    const nameEl = row.querySelector('.ffm-name');
    if (!nameEl) return;
    const isF = file instanceof TFolder;
    const orig = isF ? file.name : file.basename;
    const ext = isF ? '' : file.extension ? '.' + file.extension : '';
    row.draggable = false;
    const input = createEl('input', { cls: 'ffm-rename', type: 'text' });
    input.value = orig;
    nameEl.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = async (ok) => {
      if (done) return; done = true;
      const v = input.value.trim();
      if (ok && v && v !== orig) await this.plugin.renameTo(file, v + ext);
      this.render();
      this.el.focus();
    };
    ['click', 'dblclick', 'mousedown', 'contextmenu'].forEach((n) => input.addEventListener(n, (e) => e.stopPropagation()));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  showMenu(e, file) {
    const p = this.plugin, s = p.settings, m = new Menu();
    const sel = this.getSelectedFiles();
    const desktop = Platform.isDesktop;
    const add = (title, icon, fn) => m.addItem((i) => i.setTitle(title).setIcon(icon).onClick(fn));

    const openables = sel.filter((f) => f instanceof TFile);
    if (openables.length) {
      add(_t("Open"), 'file-text', () => openables.forEach((f) => p.openFile(f)));
      add(p.tabLabel(), 'square-plus', () => openables.forEach((f) => p.openFile(f, 'tab')));
      add(_t("Open to the right"), 'separator-vertical', () => openables.forEach((f) => p.openFile(f, 'split')));
      if (desktop) add(_t("Open in new window"), 'app-window', () => openables.forEach((f) => p.openFile(f, 'window')));
    }
    if (desktop) add(_t("Show in folder"), 'folder-search', () => p.showInFolder(file));
    if (openables.length || desktop) m.addSeparator();

    if (this.selectMode) add(_t("Exit selection mode"), 'x', () => this.exitSelectMode());
    else add(_t("Enter selection mode"), 'check-square', () => this.enterSelectMode(file.path));
    m.addSeparator();

    add(_t("Add to focus zone…"), 'target', () => new AddToZoneModal(p.app, p, sel).open());
    const rootSel = sel.filter((f) => this.roots.has(f.path));
    if (this.cfg.isZone) {
      if (rootSel.length) add(_t("Remove from focus zone ({0})", rootSel.length), 'x-circle', () => p.removeFromZone(rootSel.map((f) => f.path)));
      add(_t("Create temporary folder"), 'folder-plus', () => p.promptNewGroup());
      const z = p.activeZoneObj();
      if (z && rootSel.length) {
        if (z.items.some((i) => i.group)) add(_t("Move to temporary folder…"), 'folder-input', () => p.groupPickMenu(e, rootSel));
        if (rootSel.some((f) => p.zoneGroupOf(f.path))) add(_t("Move out of temporary folder"), 'folder-output', () => p.zoneMoveToGroup(rootSel, null));
      }
    }
    m.addSeparator();

    add(_t("Copy"), 'copy', () => p.copySelection(this, false));
    add(_t("Cut"), 'scissors', () => p.copySelection(this, true));
    add(_t("Paste"), 'clipboard-paste', () => p.paste(this.pasteTarget()));
    m.addSeparator();
    add(_t("Copy path"), 'link', () => p.copyPaths(sel, false));
    add(_t("Copy full path"), 'link-2', () => p.copyPaths(sel, true));
    if (p.getBookmarks()) {
      const all = sel.every((f) => p.findBookmark(f.path));
      add(all ? _t("Remove bookmark") : _t("Add bookmark"), 'bookmark', () => p.toggleBookmarks(sel));
    }
    m.addSeparator();

    add(_t("Rename"), 'pencil', () => this.startRenameByPath(file.path));
    add(_t("Batch rename… ({0})", sel.length), 'files', () => new BatchRenameModal(p.app, p, sel).open());
    if (file instanceof TFolder) {
      add(_t("Batch rename files inside folder…"), 'files', () => {
        const inner = p.getChildren(file).filter((f) => f instanceof TFile);
        if (!inner.length) { new Notice(_t("This folder has no files")); return; }
        new BatchRenameModal(p.app, p, inner).open();
      });
    }
    m.addSeparator();
    add(_t("Appearance (icon / color)…"), 'palette', () => new StyleModal(p.app, p, sel).open());
    add(_t("Pin to top"), 'pin', () => p.pinTop(this, sel));
    if (sel.every((f) => this.pinSet.has(f.path))) add(_t("Unpin"), 'pin-off', () => p.unpin(this, sel));
    add(_t("Move up"), 'arrow-up', () => p.moveItems(this, sel, -1));
    add(_t("Move down"), 'arrow-down', () => p.moveItems(this, sel, 1));
    add(_t("Move up one level"), 'corner-left-up', () => p.outdent(sel));
    add(_t("Move down one level (into the previous folder)"), 'corner-right-down', () => p.indent(sel));
    m.addSeparator();
    add(_t("Select all (visible)"), 'check-square', () => this.selectAll());
    add(_t("Select all (including collapsed)"), 'check-check', () => this.selectEverything());
    if (file instanceof TFolder) {
      m.addSeparator();
      add(_t("New note here"), 'file-plus', () => p.promptCreate(file, 'note'));
      add(_t("New folder here"), 'folder-plus', () => p.promptCreate(file, 'folder'));
      p.newFileDefs().forEach((d) => add(_t("New {0} here", _t(d.label)), d.icon || 'file-plus', () => p.promptCreate(file, d)));
    }
    m.addSeparator();
    add(_t("Properties…"), 'info', () => new PropertiesModal(p.app, p, sel).open());
    add(_t("Delete"), 'trash', () => p.deleteFiles(sel));
    m.showAtMouseEvent(e);
  }

  showGroupMenu(e, g) {
    const p = this.plugin, m = new Menu();
    const add = (title, icon, fn) => m.addItem((i) => i.setTitle(title).setIcon(icon).onClick(fn));
    add(_t("Rename temporary folder"), 'pencil', () => p.promptRenameGroup(g));
    add(_t("Create temporary folder"), 'folder-plus', () => p.promptNewGroup());
    m.addSeparator();
    add(_t("Delete temporary folder (shortcuts move back to top level)"), 'trash', () => p.deleteGroup(g));
    m.showAtMouseEvent(e);
  }

  showBlankMenu(e) {
    const p = this.plugin, m = new Menu();
    const add = (title, icon, fn) => m.addItem((i) => i.setTitle(title).setIcon(icon).onClick(fn));
    if (this.cfg.isZone) {
      add(_t("New focus zone"), 'plus', () => p.promptNewZone());
      const z = p.activeZoneObj();
      if (z) {
        add(_t("Create temporary folder"), 'folder-plus', () => p.promptNewGroup());
        add(_t("Rename this focus zone"), 'pencil', () => p.promptRenameZone(z));
        add(_t("Delete this focus zone"), 'trash', () => p.deleteZone(z));
        m.addSeparator();
        if (this.selectMode) add(_t("Exit selection mode"), 'x', () => this.exitSelectMode());
        else add(_t("Enter selection mode"), 'check-square', () => this.enterSelectMode(null));
        add(_t("Select all (including collapsed)"), 'check-check', () => this.selectEverything());
      }
    } else {
      const root = p.treeBaseFolder();
      add(_t("New note"), 'file-plus', () => p.promptCreate(root, 'note'));
      add(_t("New folder"), 'folder-plus', () => p.promptCreate(root, 'folder'));
      p.newFileDefs().forEach((d) => add(_t("New {0}", _t(d.label)), d.icon || 'file-plus', () => p.promptCreate(root, d)));
      add(root.isRoot() ? _t("Paste to root") : _t("Paste to current folder"), 'clipboard-paste', () => p.paste(root));
      m.addSeparator();
      if (this.selectMode) add(_t("Exit selection mode"), 'x', () => this.exitSelectMode());
      else add(_t("Enter selection mode"), 'check-square', () => this.enterSelectMode(null));
      add(_t("Select all (visible)"), 'check-square', () => this.selectAll());
      add(_t("Select all (including collapsed)"), 'check-check', () => this.selectEverything());
    }
    m.showAtMouseEvent(e);
  }
}

/* ------------------------------ 視圖 ------------------------------ */
class FocusView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return _t("Focus File Manager"); }
  getIcon() { return 'folder-tree'; }

  async onOpen() {
    const p = this.plugin, root = this.contentEl;
    root.empty(); root.addClass('ffm-root');
    this.buildToolbar(root.createDiv({ cls: 'ffm-toolbar' }));
    const main = root.createDiv({ cls: 'ffm-main' });
    this.mainEl = main;
    const left = main.createDiv({ cls: 'ffm-left' });
    this.dividerEl = main.createDiv({ cls: 'ffm-divider' });
    const right = main.createDiv({ cls: 'ffm-right' });
    this.leftEl = left; this.rightEl = right;
    this.setupDivider();

    this.pathBarEl = left.createDiv({ cls: 'ffm-pathbar' });
    this.treePane = new Pane(p, left.createDiv({ cls: 'ffm-tree' }), {
      key: () => 'tree', isZone: false, onActivate: (pn) => { this.lastPane = pn; }, pathBarEl: this.pathBarEl,
      emptyText: () => (p.settings.treeStyle === 'explorer' ? _t("(This folder is empty)") : _t("(The vault is empty)")),
      getRoots: () => p.treeRoots(),
    });
    this.tabsEl = right.createDiv({ cls: 'ffm-tabs' });
    this.tabsEl.addEventListener('contextmenu', (e) => { e.preventDefault(); this.zonePane.showBlankMenu(e); });
    this.zonePane = new Pane(p, right.createDiv({ cls: 'ffm-tree' }), {
      key: () => 'zone:' + (p.settings.activeZone || ''), isZone: true, onActivate: (pn) => { this.lastPane = pn; },
      emptyText: () => (p.settings.zones.length ? _t("Select files/folders on the left, then right-click \"Add to focus zone\"") : _t("Right-click here to create a focus zone")),
      getRoots: () => p.getZoneRoots(), getEntries: () => p.zoneEntries(),
    });
    p.views.add(this);
    this.refresh();
  }
  async onClose() { this.plugin.views.delete(this); }

  toolbarKey() {
    const s = this.plugin.settings;
    return [s.modeButtonStyle || 'separate', s.toolbarStyle || 'text', s.mergeExpandCollapse ? 1 : 0, s.treeStyle || 'tree'].join('|');
  }
  makeBtn(parent) {
    const st = this.plugin.settings.toolbarStyle || 'text';
    return st === 'icon'
      ? parent.createDiv({ cls: ['clickable-icon', 'ffm-ibtn'] })
      : parent.createEl('button', { cls: 'ffm-btn' });
  }
  setBtn(b, spec) {
    const st = this.plugin.settings.toolbarStyle || 'text';
    b.empty();
    if (st === 'icon') setIcon(b, pickIcon(spec.icon));
    else {
      if (st === 'icon-text') setIcon(b.createSpan({ cls: 'ffm-btn-icon' }), pickIcon(spec.icon));
      b.createSpan({ text: _t(spec.label) });
    }
    b.setAttr('aria-label', spec.tip || _t(spec.label));
    b.toggleClass('is-on', !!spec.on);
  }
  collapseAll() { this.treePane.collapseAll(); this.zonePane.collapseAll(); this.updateToolbar(); }
  expandAll() { this.treePane.expandAll(); this.zonePane.expandAll(); this.updateToolbar(); }
  anyExpanded() {
    if (!this.treePane) return false;
    return Object.keys(this.treePane.expandedMap()).length > 0 || Object.keys(this.zonePane.expandedMap()).length > 0;
  }
  buildToolbar(bar) {
    const p = this.plugin, s = p.settings;
    this.barEl = bar;
    this.builtKey = this.toolbarKey();
    this.modeBtns = {}; this.cycleBtn = null; this.mergeBtn = null;
    bar.toggleClass('ffm-toolbar-icons', (s.toolbarStyle || 'text') === 'icon');

    if ((s.modeButtonStyle || 'separate') === 'cycle') {
      const b = this.makeBtn(bar);
      b.onclick = async () => {
        const i = VIEW_MODES.findIndex((m) => m[0] === (s.layoutMode || 'both'));
        s.layoutMode = VIEW_MODES[(i + 1) % VIEW_MODES.length][0];
        this.updateToolbar(); await p.saveSettings();
      };
      this.cycleBtn = b;
    } else {
      const grp = bar.createDiv({ cls: 'ffm-btn-group' });
      VIEW_MODES.forEach(([k]) => {
        const b = this.makeBtn(grp);
        b.onclick = async () => { s.layoutMode = k; this.updateToolbar(); await p.saveSettings(); };
        this.modeBtns[k] = b;
      });
    }

    const nn = this.makeBtn(bar);
    this.setBtn(nn, { icon: 'file-plus', label: _t("New note") });
    nn.onclick = () => this.createInTarget('note');
    const nf = this.makeBtn(bar);
    this.setBtn(nf, { icon: 'folder-plus', label: _t("New folder") });
    nf.onclick = () => this.createInTarget('folder');

    this.crossBtn = this.makeBtn(bar);
    this.crossBtn.onclick = async () => { s.crossLevelMove = !s.crossLevelMove; this.updateToolbar(); await p.saveSettings(); };
    this.sortBtn = this.makeBtn(bar);
    this.sortBtn.onclick = (e) => {
      const m = new Menu();
      const addSort = (mode) => m.addItem((i) => i.setTitle(_t(SORT_MODES[mode])).setChecked((s.sortMode || 'default') === mode).onClick(() => p.setSortMode(mode)));
      addSort('default'); addSort('manual'); m.addSeparator();
      ['name-asc', 'name-desc'].forEach(addSort); m.addSeparator();
      ['mtime-desc', 'mtime-asc'].forEach(addSort); m.addSeparator();
      ['ctime-desc', 'ctime-asc'].forEach(addSort);
      m.addSeparator();
      m.addItem((i) => i.setTitle(_t("Reset manual order…")).setIcon('rotate-ccw').onClick(() =>
        new ConfirmModal(p.app, _t("Reset the manual order? All manual ordering records will be cleared."), () => p.resetManual()).open()));
      m.showAtMouseEvent(e);
    };

    if (s.treeStyle === 'explorer') { /* 電腦式樣式不需要展開／收合 */ } else if (s.mergeExpandCollapse) {
      this.mergeBtn = this.makeBtn(bar);
      this.mergeBtn.onclick = () => {
        if (!this.expandNext) this.expandNext = this.anyExpanded() ? 'collapse' : 'expand';
        const action = this.expandNext;
        if (action === 'collapse') this.collapseAll(); else this.expandAll();
        this.expandNext = action === 'collapse' ? 'expand' : 'collapse';
        this.updateToolbar();
      };
    } else {
      const c = this.makeBtn(bar);
      this.setBtn(c, { icon: 'chevrons-down-up|chevron-up', label: _t("Collapse all") });
      c.onclick = () => this.collapseAll();
      const x = this.makeBtn(bar);
      this.setBtn(x, { icon: 'chevrons-up-down|chevron-down', label: _t("Expand all") });
      x.onclick = () => this.expandAll();
    }

    const r = this.makeBtn(bar);
    this.setBtn(r, { icon: 'refresh-cw', label: _t("Refresh"), tip: _t("Refresh (manually refresh open-file markers)") });
    r.onclick = () => { p.computeOpen(); p.refreshAll(); };
    this.updateToolbar();
  }
  updateToolbar() {
    const s = this.plugin.settings, mode = s.layoutMode || 'both';
    if (this.barEl) this.barEl.toggleClass('nav-header', s.nativeClasses !== false);
    VIEW_MODES.forEach(([k, label, icon]) => {
      const b = this.modeBtns[k];
      if (b) this.setBtn(b, { icon, label, tip: _t("Show: {0}", _t(label)), on: mode === k });
    });
    if (this.cycleBtn) {
      const m = VIEW_MODES.find((x) => x[0] === mode);
      this.setBtn(this.cycleBtn, { icon: m[2], label: m[1], tip: _t("Click to switch: File manager → Focus zone → Both (current: {0})", _t(m[1])) });
    }
    const cross = s.crossLevelMove ? _t("On") : _t("Off");
    this.setBtn(this.crossBtn, { icon: 'move', label: _t("Cross-level move: {0}", cross), tip: _t("Cross-level move (limits dragging): {0}", cross), on: s.crossLevelMove });
    const sortName = !s.sortMode || s.sortMode === 'default' || !SORT_MODES[s.sortMode] ? _t("Default") : s.sortMode === 'manual' ? _t("Manual") : _t(SORT_MODES[s.sortMode]);
    this.setBtn(this.sortBtn, { icon: 'arrow-up-down', label: _t("Sort: {0}", sortName), tip: _t("Sort order: {0}", sortName) });
    if (this.mergeBtn) {
      if (!this.expandNext) this.expandNext = this.anyExpanded() ? 'collapse' : 'expand';
      if (this.expandNext === 'collapse' && !this.anyExpanded()) this.expandNext = 'expand';
      this.setBtn(this.mergeBtn, this.expandNext === 'collapse'
        ? { icon: 'chevrons-down-up|chevron-up', label: _t("Collapse all"), tip: _t("Collapse all (press again to switch to expand all)") }
        : { icon: 'chevrons-up-down|chevron-down', label: _t("Expand all"), tip: _t("Expand all (press again to switch to collapse all)") });
    }
    if (this.leftEl) this.applyLayout();
  }
  createInTarget(kind) {
    const mode = this.plugin.settings.layoutMode || 'both';
    const pane = mode === 'zone' ? this.zonePane : mode === 'tree' ? this.treePane : this.lastPane || this.treePane;
    this.plugin.promptCreate(pane.pasteTarget(), kind);
  }
  applyLayout() {
    const s = this.plugin.settings, mode = s.layoutMode || 'both';
    const showL = mode !== 'zone', showR = mode !== 'tree';
    this.leftEl.style.display = showL ? '' : 'none';
    this.rightEl.style.display = showR ? '' : 'none';
    this.dividerEl.style.display = showL && showR ? '' : 'none';
    this.leftEl.style.flex = showL && showR ? `0 0 ${s.leftWidth || 50}%` : '1 1 0';
    this.rightEl.style.flex = '1 1 0';
  }
  setupDivider() {
    const d = this.dividerEl, p = this.plugin;
    d.addEventListener('dblclick', () => { p.settings.leftWidth = 50; this.applyLayout(); p.saveSoon(); });
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      d.setPointerCapture(e.pointerId);
      d.addClass('is-dragging');
      const rect = this.mainEl.getBoundingClientRect();
      const move = (ev) => {
        const pct = Math.min(85, Math.max(15, ((ev.clientX - rect.left) / rect.width) * 100));
        p.settings.leftWidth = Math.round(pct * 10) / 10;
        this.leftEl.style.flex = `0 0 ${p.settings.leftWidth}%`;
      };
      const up = (ev) => {
        d.removeEventListener('pointermove', move);
        d.removeEventListener('pointerup', up);
        try { d.releasePointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
        d.removeClass('is-dragging');
        p.saveSoon();
      };
      d.addEventListener('pointermove', move);
      d.addEventListener('pointerup', up);
    });
  }
  refresh() {
    if (!this.treePane) return;
    if (this.builtKey !== this.toolbarKey()) { this.barEl.empty(); this.buildToolbar(this.barEl); }
    const fs0 = this.plugin.settings;
    if (fs0.fontMode === 'custom') this.contentEl.style.setProperty('--ffm-font-size', (Number(fs0.fontSize) || 13) + 'px');
    else this.contentEl.style.removeProperty('--ffm-font-size');
    this.updateToolbar();
    this.treePane.render();
    this.renderTabs();
    this.zonePane.render();
  }
  updateIndicators() { if (this.treePane) { this.treePane.updateIndicators(); this.zonePane.updateIndicators(); } }

  renderTabs() {
    const p = this.plugin, s = p.settings;
    this.tabsEl.empty();
    s.zones.forEach((z) => {
      const t = this.tabsEl.createDiv({ cls: 'ffm-tab', text: z.name });
      t.toggleClass('is-active', z.id === s.activeZone);
      t.onclick = () => { s.activeZone = z.id; p.saveSoon(); this.refresh(); };
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); p.zoneMenu(e, z); });
    });
    const add = this.tabsEl.createDiv({ cls: 'ffm-tab', text: _t("+") });
    add.onclick = () => p.promptNewZone();
  }
}

/* ------------------------------ 插件主體 ------------------------------ */
class FocusFileManagerPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.applyLanguage();
    this.applyGuideCss();
    this.views = new Set();
    this.dragFiles = null;
    this.dragPane = null;
    this.cutPaths = new Set();
    this.openSet = new Set();
    this.visSet = new Set();
    this.activePath = null;
    this.requestRefresh = debounce(() => this.refreshAll(), 150, true);
    this.saveSoon = debounce(() => this.saveData(this.settings), 600, true);
    this.updateIndicatorsSoon = debounce(() => {
      this.computeOpen();
      this.views.forEach((v) => v.updateIndicators());
    }, 80, true);

    this.registerView(VIEW_TYPE, (leaf) => new FocusView(leaf, this));
    this.addRibbonIcon('folder-tree', _t("Focus File Manager"), () => this.activateView('sidebar'));
    this.addCommand({ id: 'open-focus-file-manager-sidebar', name: _t("Open Focus File Manager in sidebar"), callback: () => this.activateView('sidebar') });
    this.addCommand({ id: 'open-focus-file-manager-main', name: _t("Open Focus File Manager in main area"), callback: () => this.activateView('main') });
    [['show-tree-only', _t("Show file manager only"), 'tree'], ['show-zone-only', _t("Show focus zone only"), 'zone'], ['show-both', _t("Show both"), 'both']].forEach(([id, name, mode]) =>
      this.addCommand({ id, name, callback: () => this.setLayoutMode(mode) }));
    this.addCommand({ id: 'cycle-layout', name: _t("Cycle view (File manager → Focus zone → Both)"), callback: () => this.cycleLayoutMode() });
    this.memClip = null;
    this.initNav();
    this.addSettingTab(new FFMSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.computeOpen();
      const v = this.app.vault;
      this.registerEvent(v.on('create', () => this.requestRefresh()));
      this.registerEvent(v.on('delete', (f) => { this.onDelete(f); this.requestRefresh(); }));
      this.registerEvent(v.on('rename', (f, old) => { this.onRename(f, old); this.requestRefresh(); this.updateIndicatorsSoon(); }));
      this.registerEvent(v.on('modify', () => { if (this.settings.show.size || /^mtime/.test(this.settings.sortMode || '')) this.requestRefresh(); }));
      try {
        const bm = this.getBookmarks();
        if (bm && bm.on) this.registerEvent(bm.on('changed', () => this.requestRefresh()));
      } catch (e) { /* ignore */ }
      ['file-open', 'active-leaf-change', 'layout-change'].forEach((n) =>
        this.registerEvent(this.app.workspace.on(n, () => this.updateIndicatorsSoon())));
    });
  }

  /* ---- 設定 ---- */
  async loadSettings() {
    const d = (await this.loadData()) || {};
    const s = clone(DEFAULT_SETTINGS);
    Object.assign(s, d);
    s.show = Object.assign({}, DEFAULT_SETTINGS.show, d.show);
    s.viewingMark = Object.assign({}, DEFAULT_SETTINGS.viewingMark, d.viewingMark);
    s.backgroundMark = Object.assign({}, DEFAULT_SETTINGS.backgroundMark, d.backgroundMark);
    s.icons = Object.assign({}, DEFAULT_SETTINGS.icons, d.icons);
    if ((d.settingsVersion || 1) < 2) s.mergeExpandCollapse = true;
    s.settingsVersion = 2;
    if (!s.styles) s.styles = {};
    if (!Array.isArray(s.guideStyles)) s.guideStyles = [];
    if (!Array.isArray(s.styleTemplates)) s.styleTemplates = [];
    if (!Array.isArray(s.customLangs)) s.customLangs = [];
    if (!Array.isArray(s.renamePresets) || !s.renamePresets.length) s.renamePresets = DEFAULT_PRESETS();
    this.settings = s;
    this.rebuildAliases();
  }
  rebuildAliases() {
    const map = {};
    String(this.settings.colorAliases || '').split('\n').forEach((line) => {
      const i = line.indexOf('=');
      if (i > 0) {
        const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
        if (k && v) map[k] = v;
      }
    });
    this.aliasMap = map;
    const em = {};
    String(this.settings.extIcons || '').split('\n').forEach((line) => {
      const i = line.indexOf('=');
      if (i > 0) {
        const k = line.slice(0, i).trim().replace(/^\./, '').toLowerCase(), v = line.slice(i + 1).trim();
        if (k && v) em[k] = v;
      }
    });
    this.extIconMap = em;
  }
  extIcon(file) { return (this.extIconMap && this.extIconMap[String(file.extension).toLowerCase()]) || null; }
  setAnyIcon(el, spec) {
    el.empty();
    spec = String(spec || '').trim();
    if (!spec) return;
    if (!this._iconIds) {
      try { this._iconIds = new Set(obsidian.getIconIds ? obsidian.getIconIds() : []); } catch (e) { this._iconIds = new Set(); }
    }
    const ids = this._iconIds;
    if (ids.size ? ids.has(spec) || ids.has('lucide-' + spec) : /^[a-z0-9-]+$/i.test(spec)) setIcon(el, spec);
    else el.setText(spec);
  }
  async saveSettings() { this.rebuildAliases(); this.applyGuideCss(); await this.saveData(this.settings); }
  onunload() { if (this.guideStyleEl) { try { this.guideStyleEl.remove(); } catch (e) { /* ignore */ } } }
  applyGuideCss() {
    if (typeof document === 'undefined' || !document.head || !document.createElement) return;
    if (!this.guideStyleEl) {
      this.guideStyleEl = document.createElement('style');
      this.guideStyleEl.id = 'ffm-guide-css';
      document.head.appendChild(this.guideStyleEl);
    }
    const css = sanitizeGuideCss(this.settings.guideCss);
    this.guideStyleEl.textContent = css ? `.ffm-tree.ffm-guides .ffm-children { ${css} }` : '';
  }
  guideStyleFromSettings() {
    const s = this.settings;
    return {
      app: 'focus-file-manager', type: 'guide-style', version: 1,
      name: s.guideStyleName || _t("My indent guide style"), description: '',
      lineStyle: GUIDE_LINES.includes(s.guideLine) ? s.guideLine : 'solid',
      width: Number(s.guideWidth) || 1, opacity: Number(s.guideOpacity) || 100, color: s.guideColor || '',
      offset: s.guideOffset === undefined ? 12 : Number(s.guideOffset) || 0, css: s.guideCss || '',
    };
  }
  async applyGuideStyle(st) {
    const s = this.settings;
    s.guideLine = st.lineStyle; s.guideWidth = st.width; s.guideOpacity = st.opacity;
    s.guideColor = st.color; s.guideOffset = st.offset; s.guideCss = st.css; s.guideStyleName = st.name;
    await this.saveSettings(); this.refreshAll();
  }
  applyLanguage() {
    const s = this.settings;
    let code = s.language || 'auto';
    const findCustom = (name) => s.customLangs.find((l) => l.name.toLowerCase() === String(name).toLowerCase());
    if (code === 'auto') {
      const loc = detectSystemLocale();
      const b = builtinFor(loc);
      const c = findCustom(loc) || findCustom(loc.split(/[-_]/)[0]);
      // 優先使用內建語言；沒有內建才找導入的同名語言；都沒有就用英文
      code = b || (c ? 'custom:' + c.name : 'en');
    }
    let map = null;
    if (code.startsWith('custom:')) {
      const c = findCustom(code.slice(7));
      if (c) map = c.strings; else code = 'en';
    } else {
      map = LANG_DATA[code] || null;
      if (!map) code = 'en';
    }
    I18N = { code, map };
  }
  async exportLanguage(path, which) {
    try {
      const strings = Object.create(null);
      LANG_KEYS.forEach((k) => {
        const cur = I18N.map && typeof I18N.map[k] === 'string' ? I18N.map[k] : '';
        strings[k] = which === 'en' ? k : cur || k;
      });
      const data = {
        _meta: {
          plugin: 'focus-file-manager', format: 1,
          language: which === 'en' ? 'English (default template)' : I18N.code,
          note: 'Edit only the VALUES inside "strings" (the keys are the English source text). Keep placeholders such as {0} and {1}. Import the file in the plugin settings; the language will be named after the file name.',
        },
        strings,
      };
      await this.writeTextFile(path, JSON.stringify(data, null, 2));
      new Notice(_t("Language file exported: ") + path);
    } catch (e) { new Notice(_t("Export failed: ") + e.message); }
  }
  async importLanguage(path) {
    try {
      const data = JSON.parse(await this.readTextFile(path));
      const raw = data && typeof data === 'object' && data.strings && typeof data.strings === 'object' ? data.strings : data;
      const strings = Object.create(null);
      let count = 0;
      Object.keys(raw || {}).forEach((k) => {
        if (k === '_meta') return;
        if (typeof raw[k] === 'string' && raw[k]) { strings[k] = raw[k]; count++; }
      });
      if (!count) { new Notice(_t("No usable translations in the file")); return; }
      const name = (String(path).replace(/\\/g, '/').split('/').pop().replace(/\.json$/i, '').trim() || 'custom').slice(0, 40);
      const s = this.settings;
      const k = s.customLangs.findIndex((l) => l.name === name);
      const entry = { name, strings: Object.assign({}, strings) };
      if (k >= 0) s.customLangs[k] = entry; else s.customLangs.push(entry);
      s.language = 'custom:' + name;
      this.applyLanguage();
      await this.saveSettings(); this.refreshAll();
      new Notice(_t("Imported language \"{0}\" ({1} strings)", name, count));
    } catch (e) { new Notice(_t("Import failed: ") + e.message); }
  }
  async removeLanguage(name) {
    const s = this.settings;
    s.customLangs = s.customLangs.filter((l) => l.name !== name);
    if (s.language === 'custom:' + name) s.language = 'auto';
    this.applyLanguage();
    await this.saveSettings(); this.refreshAll();
    new Notice(_t("Removed language \"{0}\"", name));
  }
  // 「全部展開／全部收合」的排除清單：名稱（任何位置同名資料夾）或路徑，可用 * 與 ? 萬用字元
  excludeMatcher() {
    const s = this.settings;
    const pats = [];
    if (s.expandExcludeOn) {
      String(s.expandExclude || '').split('\n').forEach((line) => {
        const x = line.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!x) return;
        const re = new RegExp('^' + x.split('').map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : escapeRe(ch))).join('') + '$', 'i');
        pats.push({ re, byPath: x.includes('/') });
      });
    }
    const match = (path) => {
      if (!pats.length) return false;
      const name = path.split('/').pop();
      return pats.some((q) => q.re.test(q.byPath ? path : name));
    };
    const under = (path) => {
      if (!pats.length) return false;
      let acc = '';
      for (const part of path.split('/')) { acc = acc ? acc + '/' + part : part; if (match(acc)) return true; }
      return false;
    };
    return { match, under };
  }
  async ensureVaultDir(dir) {
    const ad = this.app.vault.adapter;
    let acc = '';
    for (const part of dir.split('/').filter(Boolean)) {
      acc = acc ? acc + '/' + part : part;
      if (!(await ad.exists(acc))) await ad.mkdir(acc);
    }
  }
  async writeTextFile(path, text) {
    path = String(path || '').trim();
    if (!path) throw new Error(_t("Please enter a path first"));
    if (HAS_NODE && nodePath.isAbsolute(path)) {
      fs.mkdirSync(nodePath.dirname(path), { recursive: true });
      fs.writeFileSync(path, text, 'utf8');
      return;
    }
    const rel = path.replace(/\\/g, '/').replace(/^\/+/, '');
    const i = rel.lastIndexOf('/');
    if (i > 0) await this.ensureVaultDir(rel.slice(0, i));
    await this.app.vault.adapter.write(rel, text);
  }
  async readTextFile(path) {
    path = String(path || '').trim();
    if (!path) throw new Error(_t("Please enter a path first"));
    if (HAS_NODE && nodePath.isAbsolute(path)) {
      if (!fs.existsSync(path)) throw new Error(_t("File not found: ") + path);
      return fs.readFileSync(path, 'utf8');
    }
    const rel = path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!(await this.app.vault.adapter.exists(rel))) throw new Error(_t("File not found: ") + rel);
    return this.app.vault.adapter.read(rel);
  }
  async exportGuideStyle(path) {
    try {
      await this.writeTextFile(path, JSON.stringify(this.guideStyleFromSettings(), null, 2));
      new Notice(_t("Indent guide style exported: ") + path);
    } catch (e) { new Notice(_t("Export failed: ") + e.message); }
  }
  async exportGuideTemplates(path) {
    try {
      path = String(path || '').trim();
      const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/';
      const file = (i > 0 ? path.slice(0, i) + sep : '') + 'guide-style-templates.json';
      await this.writeTextFile(file, JSON.stringify({ app: 'focus-file-manager', type: 'guide-style-templates', version: 1, templates: GUIDE_TEMPLATES }, null, 2));
      new Notice(_t("Template reference exported: ") + file);
    } catch (e) { new Notice(_t("Export failed: ") + e.message); }
  }
  async importGuideStyle(path) {
    try {
      const data = JSON.parse(await this.readTextFile(path));
      const list = Array.isArray(data) ? data : Array.isArray(data.templates) ? data.templates : [data];
      const styles = list.map((o, i) => normalizeGuideStyle(o, _t("Imported style {0}", i + 1))).filter(Boolean);
      if (!styles.length) { new Notice(_t("No usable styles in the file")); return; }
      const s = this.settings;
      styles.forEach((st) => {
        const k = s.guideStyles.findIndex((x) => x.name === st.name);
        if (k >= 0) s.guideStyles[k] = st; else s.guideStyles.push(st);
      });
      if (styles.length === 1) await this.applyGuideStyle(styles[0]); else await this.saveSettings();
      new Notice(styles.length === 1 ? _t("Imported and applied \"{0}\"", styles[0].name) : _t("Imported {0} styles; choose one from \"Style template\"", styles.length));
    } catch (e) { new Notice(_t("Import failed: ") + e.message); }
  }

  /* ---- 視圖開啟 ---- */
  async activateView(where) {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) { ws.revealLeaf(existing); return; }
    let leaf = null;
    if (where === 'sidebar') { try { leaf = ws.getLeftLeaf(true); } catch (e) { leaf = null; } }
    if (!leaf) leaf = ws.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    ws.revealLeaf(leaf);
  }
  refreshAll() { this._iconIds = null; this._tcache = new Map(); this.views.forEach((v) => v.refresh()); }

  findMainLeaf() {
    const ws = this.app.workspace;
    let leaf = ws.getMostRecentLeaf(ws.rootSplit);
    if (!leaf || leaf.view.getViewType() === VIEW_TYPE) {
      leaf = null;
      ws.iterateRootLeaves((l) => { if (!leaf && l.view.getViewType() !== VIEW_TYPE) leaf = l; });
    }
    return leaf;
  }
  // how: undefined=依設定 | 'current' | 'tab'（依設定在右側或末尾）| 'split'（右側分割）| 'window'（新視窗）
  openFile(file, how) {
    const s = this.settings, ws = this.app.workspace;
    if (how === undefined) how = s.openMode === 'tab' ? 'tab' : 'current';
    else if (how === true) how = 'tab';
    else if (how === false) how = 'current';
    const base = this.findMainLeaf();
    let leaf;
    try {
      if (how === 'window') leaf = ws.openPopoutLeaf();
      else if (how === 'split') leaf = base ? ws.createLeafBySplit(base, 'vertical', false) : ws.getLeaf('split', 'vertical');
      else if (how === 'tab') {
        if (base) {
          const par = base.parent;
          const idx = s.newTabPosition === 'end' ? par.children.length : par.children.indexOf(base) + 1;
          leaf = ws.createLeafInParent(par, idx);
        } else leaf = ws.getLeaf('tab');
      } else leaf = base || ws.getLeaf('split', 'vertical');
    } catch (e) { leaf = ws.getLeaf('tab'); }
    leaf.openFile(file);
  }
  tabLabel() { return this.settings.newTabPosition === 'end' ? _t("Open in new tab at the end") : _t("Open in new tab to the right"); }
  showInFolder(file) {
    try {
      const { shell } = require('electron');
      shell.showItemInFolder(nodePath.join(this.basePath(), file.path));
    } catch (e) {
      try { this.app.showInFolder(file.path); } catch (e2) { new Notice(_t("Showing in folder is not supported on this platform")); }
    }
  }
  async setLayoutMode(mode) {
    this.settings.layoutMode = mode;
    await this.saveSettings();
    const ws = this.app.workspace, leaf = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) await this.activateView('sidebar'); else ws.revealLeaf(leaf);
    this.refreshAll();
  }
  cycleLayoutMode() {
    const i = VIEW_MODES.findIndex((m) => m[0] === (this.settings.layoutMode || 'both'));
    return this.setLayoutMode(VIEW_MODES[(i + 1) % VIEW_MODES.length][0]);
  }
  fmtSize(n) {
    const s = this.settings;
    if (s.sizeMode !== 'custom') return fmtSize(n);
    const base = Number(s.sizeBase) === 1000 ? 1000 : 1024;
    const d = Math.max(0, Math.min(6, Number(s.sizeDecimals) || 0));
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    if ((s.sizeUnit || 'auto') === 'auto') { let v = n; while (v >= base && i < units.length - 1) { v /= base; i++; } }
    else i = Math.max(0, units.indexOf(s.sizeUnit));
    const v = n / Math.pow(base, i);
    return `${i === 0 ? Math.round(v) : v.toFixed(d)} ${units[i]}`;
  }
  timeTip(st) { return _t("Last modified: {0}\nCreated: {1}", fmtDate(st.mtime), fmtDate(st.ctime)); }

  /* ---- 排序 / 子項 ---- */
  // 資料夾沒有自己的時間：編輯時間取內容中最新的、創建時間取內容中最舊的
  folderTime(f, kind) {
    if (f instanceof TFile) return f.stat[kind];
    if (!this._tcache) this._tcache = new Map();
    const key = kind + ':' + f.path;
    if (this._tcache.has(key)) return this._tcache.get(key);
    let v = kind === 'mtime' ? 0 : Infinity;
    const walk = (d) => d.children.forEach((c) => {
      if (c instanceof TFolder) walk(c);
      else v = kind === 'mtime' ? Math.max(v, c.stat.mtime) : Math.min(v, c.stat.ctime);
    });
    walk(f);
    if (v === Infinity) v = 0;
    this._tcache.set(key, v);
    return v;
  }
  getChildren(folder, levelOnly) {
    const s = this.settings, mode = s.sortMode || 'default';
    let kids = [...folder.children];
    if (levelOnly) kids = kids.filter((k) => k instanceof TFile);
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    const foldersFirst = s.sortFoldersFirst !== false;
    const tm = /^(mtime|ctime)-(asc|desc)$/.exec(mode);
    kids.sort((a, b) => {
      const af = a instanceof TFolder, bf = b instanceof TFolder;
      if (foldersFirst && af !== bf) return af ? -1 : 1;
      if (tm) {
        const d = this.folderTime(a, tm[1]) - this.folderTime(b, tm[1]);
        if (d) return tm[2] === 'desc' ? -d : d;
        return byName(a, b);
      }
      return mode === 'name-desc' ? byName(b, a) : byName(a, b);
    });
    if (mode === 'manual' && s.manualOrder[folder.path]) {
      const idx = new Map(s.manualOrder[folder.path].map((n, i) => [n, i]));
      kids.sort((a, b) => (idx.has(a.name) ? idx.get(a.name) : 1e9) - (idx.has(b.name) ? idx.get(b.name) : 1e9));
    }
    if (s.pinned.length) {
      const pi = (f) => s.pinned.indexOf(f.path);
      const pinned = kids.filter((k) => pi(k) >= 0).sort((a, b) => pi(a) - pi(b));
      kids = [...pinned, ...kids.filter((k) => pi(k) < 0)];
    }
    return kids;
  }
  async setSortMode(mode) { this.settings.sortMode = mode; await this.saveSettings(); this.refreshAll(); }
  async resetManual() { this.settings.manualOrder = {}; await this.saveSettings(); this.refreshAll(); new Notice(_t("Manual order reset")); }

  countInfo(folder) {
    const s = this.settings;
    const exts = String(s.countExtensions || '').split(',').map((x) => x.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
    const all = !exts.length || exts.includes('*');
    let files = 0, dirs = 0;
    const walk = (f) => {
      for (const c of f.children) {
        if (c instanceof TFolder) { dirs++; if (s.countRecursive) walk(c); }
        else if (all || exts.includes(c.extension.toLowerCase())) files++;
      }
    };
    walk(folder);
    return { files, dirs };
  }

  async moveItems(pane, files, dir) {
    const s = this.settings;
    const rootSel = pane.cfg.isZone && files.every((f) => pane.roots.has(f.path));
    if (rootSel) {
      const z = this.activeZoneObj();
      const set = new Set(files.map((f) => f.path));
      for (const arr of this.zoneContainers(z)) {
        if (!arr.some((it) => !it.group && set.has(it.path))) continue;
        const shifted = shiftSelected(arr, (it) => !it.group && set.has(it.path), dir);
        arr.splice(0, arr.length, ...shifted);
      }
    } else {
      if (s.sortMode !== 'manual') { s.sortMode = 'manual'; new Notice(_t("Switched to manual order")); }
      const by = new Map();
      files.forEach((f) => { if (!f.parent) return; if (!by.has(f.parent)) by.set(f.parent, []); by.get(f.parent).push(f.name); });
      for (const [parent, names] of by) {
        const set = new Set(names);
        const order = this.getChildren(parent).map((c) => c.name);
        s.manualOrder[parent.path] = shiftSelected(order, (n) => set.has(n), dir);
      }
    }
    await this.saveSettings(); this.refreshAll();
  }

  async pinTop(pane, files) {
    const s = this.settings;
    if (pane.cfg.isZone && files.every((f) => pane.roots.has(f.path))) {
      const z = this.activeZoneObj();
      const set = new Set(files.map((f) => f.path));
      for (const arr of this.zoneContainers(z)) {
        const isSel = (it) => !it.group && set.has(it.path);
        arr.forEach((it) => { if (isSel(it)) it.pinned = true; });
        const sel = arr.filter(isSel), rest = arr.filter((it) => !isSel(it));
        arr.splice(0, arr.length, ...sel, ...rest);
      }
    } else {
      [...files].reverse().forEach((f) => {
        s.pinned = s.pinned.filter((p) => p !== f.path);
        s.pinned.unshift(f.path);
      });
    }
    await this.saveSettings(); this.refreshAll();
  }
  async unpin(pane, files) {
    const set = new Set(files.map((f) => f.path));
    this.settings.pinned = this.settings.pinned.filter((p) => !set.has(p));
    if (pane && pane.cfg.isZone) {
      const z = this.activeZoneObj();
      if (z) this.allZoneItems(z).forEach((it) => { if (set.has(it.path)) it.pinned = false; });
    }
    await this.saveSettings(); this.refreshAll();
  }

  /* ---- 移動 / 重新命名 ---- */
  async moveFiles(files, dest) {
    let n = 0;
    for (const f of files) {
      if (f.parent === dest) continue;
      if (dest.path === f.path || dest.path.startsWith(f.path + '/')) { new Notice(_t("Cannot move a folder into itself")); continue; }
      const np = joinPath(dest.path, f.name);
      if (this.app.vault.getAbstractFileByPath(np)) { new Notice(_t("An item with the same name already exists at the destination: {0}", f.name)); continue; }
      try { await this.app.fileManager.renameFile(f, np); n++; } catch (e) { new Notice(_t("Move failed: ") + e.message); }
    }
    return n;
  }
  async outdent(files) {
    for (const f of pruneNested(files)) {
      const p = f.parent;
      if (!p || p.isRoot() || !p.parent) { new Notice(_t("\"{0}\" is already at the top level", f.name)); continue; }
      await this.moveFiles([f], p.parent);
    }
    this.refreshAll();
  }
  async indent(files) {
    const set = new Set(files.map((f) => f.path));
    for (const f of pruneNested(files)) {
      if (!f.parent) continue;
      const sibs = this.getChildren(f.parent);
      let i = sibs.indexOf(f) - 1, target = null;
      while (i >= 0) { if (sibs[i] instanceof TFolder && !set.has(sibs[i].path)) { target = sibs[i]; break; } i--; }
      if (!target) { new Notice(_t("No folder above \"{0}\" to move it into", f.name)); continue; }
      await this.moveFiles([f], target);
    }
    this.refreshAll();
  }
  async renameTo(file, newName) {
    if (INVALID_NAME.test(newName.replace(/\.[^.]*$/, ''))) { new Notice(_t("The name contains invalid characters")); return; }
    const np = joinPath(parentPath(file.path), newName);
    if (np !== file.path && this.app.vault.getAbstractFileByPath(np)) { new Notice(_t("An item with the same name already exists")); return; }
    try { await this.app.fileManager.renameFile(file, np); } catch (e) { new Notice(_t("Rename failed: ") + e.message); }
  }
  async deleteFiles(files) {
    const list = pruneNested(files);
    if (!list.length) return;
    new ConfirmModal(this.app, _t("Delete {0} items? (moved to trash per Obsidian settings)", list.length), async () => {
      for (const f of list) { try { await this.app.fileManager.trashFile(f); } catch (e) { new Notice(_t("Delete failed: ") + e.message); } }
    }).open();
  }
  getPlugin(id) { return this.app.plugins && this.app.plugins.plugins ? this.app.plugins.plugins[id] : null; }
  newFileDefs() {
    const defs = [
      { id: 'base', label: 'Base', ext: 'base', content: 'views:\n  - type: table\n    name: Table\n', icon: 'database' },
      { id: 'canvas', label: _t("Canvas"), ext: 'canvas', content: '{}', icon: 'layout-dashboard' },
    ];
    if (this.getPlugin('obsidian-excalidraw-plugin')) defs.push({ id: 'excalidraw', label: 'Excalidraw', excalidraw: true, icon: 'pencil-line' });
    String(this.settings.newFileTypes || '').split('\n').forEach((line) => {
      const parts = line.split('|');
      if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
        defs.push({ id: 'custom-' + parts[0].trim(), label: parts[0].trim(), ext: parts[1].trim().replace(/^\./, ''), content: (parts.slice(2).join('|') || '').replace(/\\n/g, '\n'), icon: 'file-plus' });
      }
    });
    return defs;
  }
  expandFolder(folder) {
    const m = this.settings.expanded.tree || (this.settings.expanded.tree = {});
    if (!folder.isRoot()) m[folder.path] = true;
  }
  async createExcalidraw(folder, name) {
    const ex = this.getPlugin('obsidian-excalidraw-plugin');
    if (!ex || !ex.ea) { new Notice(_t("Excalidraw plugin not found; make sure it is enabled")); return; }
    try {
      if (ex.ea.reset) ex.ea.reset();
      const path = await ex.ea.create({
        filename: name.replace(/\.excalidraw(\.md)?$/i, '').replace(/\.md$/i, ''),
        foldername: folder.isRoot() ? undefined : folder.path,
        silent: true,
      });
      const f = path ? this.app.vault.getAbstractFileByPath(path) : null;
      if (f instanceof TFile) this.openFile(f);
    } catch (e) { new Notice(_t("Failed to create Excalidraw: ") + e.message); }
  }
  promptCreate(folder, kind) {
    const def = kind && typeof kind === 'object' ? kind : null;
    const title = def ? _t("New {0}", _t(def.label)) : kind === 'note' ? _t("New note") : _t("New folder");
    new TextPromptModal(this.app, title, '', async (name) => {
      if (INVALID_NAME.test(name)) { new Notice(_t("The name contains invalid characters")); return; }
      try {
        if (def && def.excalidraw) { await this.createExcalidraw(folder, name); this.expandFolder(folder); return; }
        let fname = name;
        if (def) { if (!new RegExp('\\.' + escapeRe(def.ext) + '$', 'i').test(fname)) fname += '.' + def.ext; }
        else if (kind === 'note' && !/\.[^.]+$/.test(fname)) fname += '.md';
        const path = joinPath(folder.path, fname);
        if (this.app.vault.getAbstractFileByPath(path)) { new Notice(_t("An item with the same name already exists")); return; }
        if (def) await this.app.vault.create(path, def.content || '');
        else if (kind === 'note') await this.app.vault.create(path, '');
        else await this.app.vault.createFolder(path);
        this.expandFolder(folder);
      } catch (e) { new Notice(_t("Create failed: ") + e.message); }
    }).open();
  }

  /* ---- 書籤（與 Obsidian 核心外掛連動） ---- */
  getBookmarks() {
    try {
      const ip = this.app.internalPlugins;
      const pl = ip.getEnabledPluginById ? ip.getEnabledPluginById('bookmarks') : null;
      if (pl) return pl;
      const alt = ip.plugins && ip.plugins.bookmarks;
      return alt && alt.enabled ? alt.instance : null;
    } catch (e) { return null; }
  }
  bookmarkPaths() {
    const set = new Set(), bm = this.getBookmarks();
    if (!bm) return set;
    const walk = (items) => (items || []).forEach((it) => {
      if ((it.type === 'file' || it.type === 'folder') && it.path) set.add(it.path);
      if (it.items) walk(it.items);
    });
    try { walk(bm.items); } catch (e) { /* ignore */ }
    return set;
  }
  findBookmark(path) {
    const bm = this.getBookmarks();
    if (!bm) return null;
    let found = null;
    const walk = (items) => (items || []).forEach((it) => {
      if (!found && (it.type === 'file' || it.type === 'folder') && it.path === path) found = it;
      if (it.items) walk(it.items);
    });
    try { walk(bm.items); } catch (e) { /* ignore */ }
    return found;
  }
  async toggleBookmarks(files) {
    const bm = this.getBookmarks();
    if (!bm) { new Notice(_t("The Obsidian core plugin \"Bookmarks\" is not enabled")); return; }
    const all = files.every((f) => this.findBookmark(f.path));
    try {
      if (all) files.forEach((f) => { const it = this.findBookmark(f.path); if (it) bm.removeItem(it); });
      else files.forEach((f) => { if (!this.findBookmark(f.path)) bm.addItem({ type: f instanceof TFolder ? 'folder' : 'file', path: f.path, title: '' }); });
    } catch (e) { new Notice(_t("Bookmark operation failed: ") + e.message); }
    this.refreshAll();
  }

  /* ---- 拖曳 ---- */
  markDrop(row, pos) {
    this.clearDropMarks(false);
    row.addClass('drop-' + pos);
  }
  clearDropMarks(full) {
    document.querySelectorAll('.ffm-row.drop-inside, .ffm-row.drop-before, .ffm-row.drop-after')
      .forEach((r) => r.removeClasses(['drop-inside', 'drop-before', 'drop-after']));
    document.querySelectorAll('.is-drop-target').forEach((r) => r.removeClass('is-drop-target'));
    if (full !== false) document.querySelectorAll('.ffm-row.is-dimmed').forEach((r) => r.removeClass('is-dimmed'));
  }
  async handleDrop(files, target, pos) {
    if (!files || !files.length) return;
    const s = this.settings;
    if (pos === 'inside' && target instanceof TFolder) {
      if (!s.crossLevelMove) { new Notice(_t("\"Cross-level move\" is off; cannot drop into another folder")); return; }
      await this.moveFiles(files, target);
      this.refreshAll();
      return;
    }
    const parent = target.parent || this.app.vault.getRoot();
    files = files.filter((f) => f !== target);
    if (!files.length) return;
    const same = files.every((f) => f.parent === parent);
    if (!same) {
      if (!s.crossLevelMove) { new Notice(_t("\"Cross-level move\" is off; you can only reorder within the same level")); return; }
      await this.moveFiles(files, parent);
    }
    if (s.sortMode !== 'manual') { s.sortMode = 'manual'; new Notice(_t("Switched to manual order")); }
    const moved = new Set(files.map((f) => f.name));
    const names = this.getChildren(parent).map((c) => c.name).filter((n) => !moved.has(n));
    let idx = names.indexOf(target.name);
    if (idx < 0) idx = names.length; else if (pos === 'after') idx++;
    names.splice(idx, 0, ...files.map((f) => f.name));
    s.manualOrder[parent.path] = names;
    await this.saveSettings(); this.refreshAll();
  }

  async crossPaneDrop(src, dst, files) {
    if (dst.cfg.isZone && !src.cfg.isZone) {
      const z = this.activeZoneObj();
      if (!z) { new AddToZoneModal(this.app, this, files).open(); return; }
      await this.addToZone(z.id, files, this.settings.dragAddMode || 'all');
    } else if (!dst.cfg.isZone && src.cfg.isZone) {
      const roots = files.filter((f) => src.roots.has(f.path));
      if (!roots.length) { new Notice(_t("Only top-level items can be removed from a focus zone")); return; }
      await this.removeFromZone(roots.map((f) => f.path));
      new Notice(_t("Removed {0} items from the focus zone", roots.length));
    }
  }

  /* ---- 剪貼簿（含跨庫） ---- */
  basePath() { try { return this.app.vault.adapter.getBasePath ? this.app.vault.adapter.getBasePath() : ''; } catch (e) { return ''; } }
  async copySelection(pane, cut) {
    const files = pruneNested(pane.getSelectedFiles());
    if (!files.length) return;
    this.memClip = { op: cut ? 'cut' : 'copy', paths: files.map((f) => f.path) };
    const base = this.basePath();
    try {
      if (HAS_NODE && base) {
        const abs = files.map((f) => nodePath.join(base, f.path));
        fs.writeFileSync(CLIP_FILE, JSON.stringify({ op: cut ? 'cut' : 'copy', absPaths: abs }));
        await navigator.clipboard.writeText(abs.join('\n'));
      } else {
        await navigator.clipboard.writeText(files.map((f) => f.path).join('\n'));
      }
    } catch (e) { /* 剪貼簿不可用時仍可在本庫內貼上 */ }
    this.cutPaths = cut ? new Set(files.map((f) => f.path)) : new Set();
    this.refreshAll();
    new Notice(cut ? _t("Cut {0} items", files.length) : _t("Copied {0} items", files.length));
  }
  async readClip() {
    if (!HAS_NODE) return null;
    try {
      const text = (await navigator.clipboard.readText()).trim();
      const j = JSON.parse(fs.readFileSync(CLIP_FILE, 'utf8'));
      if (Array.isArray(j.absPaths) && j.absPaths.join('\n').trim() === text) return j;
    } catch (e) { /* ignore */ }
    return null;
  }
  uniqueVaultPath(dir, name, isDir) {
    const dot = name.lastIndexOf('.');
    const hasExt = !isDir && dot > 0;
    const b = hasExt ? name.slice(0, dot) : name, e = hasExt ? name.slice(dot) : '';
    let cand = joinPath(dir, name), i = 0;
    while (this.app.vault.getAbstractFileByPath(cand)) { i++; cand = joinPath(dir, `${b} copy${i > 1 ? ' ' + i : ''}${e}`); }
    return cand;
  }
  uniqueFsPath(dirAbs, name, isDir) {
    const dot = name.lastIndexOf('.');
    const hasExt = !isDir && dot > 0;
    const b = hasExt ? name.slice(0, dot) : name, e = hasExt ? name.slice(dot) : '';
    let cand = nodePath.join(dirAbs, name), i = 0;
    while (fs.existsSync(cand)) { i++; cand = nodePath.join(dirAbs, `${b} copy${i > 1 ? ' ' + i : ''}${e}`); }
    return cand;
  }
  async copyInVault(src, destFolder) {
    const dest = this.uniqueVaultPath(destFolder.path, src.name, src instanceof TFolder);
    if (src instanceof TFolder) {
      const kids = [...src.children];
      await this.app.vault.createFolder(dest);
      const df = this.app.vault.getAbstractFileByPath(dest);
      for (const c of kids) await this.copyInVault(c, df);
    } else {
      await this.app.vault.copy(src, dest);
    }
  }
  async pasteRel(clip, destFolder) {
    let n = 0;
    for (const rel of clip.paths) {
      const src = this.app.vault.getAbstractFileByPath(rel);
      if (!src) continue;
      try {
        if (clip.op === 'cut') await this.moveFiles([src], destFolder);
        else await this.copyInVault(src, destFolder);
        n++;
      } catch (e) { console.error(e); new Notice(_t("Paste failed: ") + e.message); }
    }
    if (clip.op === 'cut') { this.memClip = null; this.cutPaths = new Set(); }
    new Notice(_t("Pasted {0} items", n));
    this.refreshAll();
  }
  async paste(destFolder) {
    const clip = await this.readClip();
    if (!clip) {
      if (this.memClip) { await this.pasteRel(this.memClip, destFolder); return; }
      new Notice(_t("No files or folders on the clipboard to paste"));
      return;
    }
    const base = this.basePath();
    let n = 0;
    for (const abs of clip.absPaths) {
      try {
        const rel = nodePath.relative(base, abs);
        const inVault = rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel);
        const src = inVault ? this.app.vault.getAbstractFileByPath(rel.split(nodePath.sep).join('/')) : null;
        if (src) {
          if (clip.op === 'cut') await this.moveFiles([src], destFolder);
          else await this.copyInVault(src, destFolder);
        } else {
          if (!fs.existsSync(abs)) continue;
          const isDir = fs.statSync(abs).isDirectory();
          const destDir = nodePath.join(base, destFolder.isRoot() ? '' : destFolder.path);
          fs.cpSync(abs, this.uniqueFsPath(destDir, nodePath.basename(abs), isDir), { recursive: true });
          if (clip.op === 'cut') fs.rmSync(abs, { recursive: true, force: true });
        }
        n++;
      } catch (e) { console.error(e); new Notice(_t("Paste failed: ") + e.message); }
    }
    if (clip.op === 'cut') { try { fs.unlinkSync(CLIP_FILE); } catch (e) { /* ignore */ } this.cutPaths = new Set(); this.memClip = null; }
    new Notice(_t("Pasted {0} items", n));
    setTimeout(() => this.refreshAll(), 400);
  }
  async copyPaths(files, absolute) {
    const base = this.basePath();
    const list = files.map((f) => (absolute && HAS_NODE && base ? nodePath.join(base, f.path) : f.path));
    await navigator.clipboard.writeText(list.join('\n'));
    new Notice(_t("Copied {0} paths", list.length));
  }

  /* ---- 電腦式文件管理（逐層進入） ---- */
  initNav() { this.nav = { path: this.settings.explorerPath || '/', back: [], fwd: [] }; }
  validFolderPath(path) {
    if (!path || path === '/') return '/';
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFolder ? f.path : null;
  }
  treeBaseFolder() {
    const root = this.app.vault.getRoot();
    if (this.settings.treeStyle !== 'explorer') return root;
    const f = this.nav.path === '/' ? root : this.app.vault.getAbstractFileByPath(this.nav.path);
    if (f instanceof TFolder) return f;
    this.nav.path = '/';
    return root;
  }
  treeRoots() { return this.getChildren(this.treeBaseFolder()).map((f) => ({ file: f })); }
  setNavPath(path) {
    this.nav.path = path;
    this.settings.explorerPath = path;
    this.saveSoon();
    this.views.forEach((v) => { if (v.treePane) { v.treePane.selection = new Set(); v.treePane.lastClicked = null; } });
    this.refreshAll();
  }
  navigate(path) {
    const v = this.validFolderPath(path);
    if (v === null) { new Notice(_t("Folder not found")); return; }
    if (v === this.nav.path) return;
    this.nav.back.push(this.nav.path);
    this.nav.fwd = [];
    this.setNavPath(v);
  }
  navBack() {
    while (this.nav.back.length) {
      const v = this.validFolderPath(this.nav.back.pop());
      if (v !== null) { this.nav.fwd.push(this.nav.path); this.setNavPath(v); return; }
    }
  }
  navForward() {
    while (this.nav.fwd.length) {
      const v = this.validFolderPath(this.nav.fwd.pop());
      if (v !== null) { this.nav.back.push(this.nav.path); this.setNavPath(v); return; }
    }
  }
  navUp() { if (this.nav.path !== '/') this.navigate(parentPath(this.nav.path)); }

  /* ---- 專注區 ---- */
  activeZoneObj() { return this.settings.zones.find((z) => z.id === this.settings.activeZone) || null; }
  zoneContainers(z) { return [z.items].concat(z.items.filter((i) => i.group).map((g) => g.items)); }
  allZoneItems(z) {
    const out = [];
    this.zoneContainers(z).forEach((arr) => arr.forEach((i) => { if (!i.group) out.push(i); }));
    return out;
  }
  zoneGroupOf(path) {
    const z = this.activeZoneObj();
    if (!z) return null;
    return z.items.find((g) => g.group && g.items.some((i) => i.path === path)) || null;
  }
  zoneEntries() {
    const z = this.activeZoneObj();
    if (!z) return [];
    const toRoot = (it) => {
      const f = this.app.vault.getAbstractFileByPath(it.path);
      return f ? { kind: 'item', file: f, levelOnly: f instanceof TFolder && !it.includeSub } : null;
    };
    const sortPin = (arr) => [...arr.filter((i) => !i.group && i.pinned), ...arr.filter((i) => i.group || !i.pinned)];
    const out = [];
    for (const it of sortPin(z.items)) {
      if (it.group) out.push({ kind: 'group', group: it, children: sortPin(it.items).map(toRoot).filter(Boolean) });
      else { const r = toRoot(it); if (r) out.push(r); }
    }
    return out;
  }
  getZoneRoots() {
    const out = [];
    this.zoneEntries().forEach((en) => {
      if (en.kind === 'group') en.children.forEach((c) => out.push({ file: c.file, levelOnly: c.levelOnly }));
      else out.push({ file: en.file, levelOnly: en.levelOnly });
    });
    return out;
  }
  promptNewGroup() {
    const z = this.activeZoneObj();
    if (!z) { new Notice(_t("Please create a focus zone first")); return; }
    new TextPromptModal(this.app, _t("Create temporary folder"), '', async (name) => {
      z.items.push({ group: true, id: uid(), name, items: [] });
      await this.saveSettings(); this.refreshAll();
    }).open();
  }
  promptRenameGroup(g) {
    new TextPromptModal(this.app, _t("Rename temporary folder"), g.name, async (name) => { g.name = name; await this.saveSettings(); this.refreshAll(); }).open();
  }
  deleteGroup(g) {
    new ConfirmModal(this.app, _t("Delete temporary folder \"{0}\"? Its shortcuts will move back to the top level of the focus zone (real files are not deleted).", g.name), async () => {
      const z = this.activeZoneObj();
      if (!z) return;
      const i = z.items.indexOf(g);
      if (i >= 0) z.items.splice(i, 1, ...g.items);
      await this.saveSettings(); this.refreshAll();
    }).open();
  }
  groupPickMenu(e, files) {
    const z = this.activeZoneObj();
    if (!z) return;
    const m = new Menu();
    z.items.filter((i) => i.group).forEach((g) => m.addItem((it) => it.setTitle(g.name).setIcon('folder').onClick(() => this.zoneMoveToGroup(files, g.id))));
    m.showAtPosition({ x: e.clientX, y: e.clientY });
  }
  async zoneMoveToGroup(files, groupId) {
    const z = this.activeZoneObj();
    if (!z) return;
    const paths = new Set(files.map((f) => f.path));
    const moved = [];
    for (const arr of this.zoneContainers(z)) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (!arr[i].group && paths.has(arr[i].path)) moved.unshift(arr.splice(i, 1)[0]);
      }
    }
    if (!moved.length) { new Notice(_t("Only shortcuts inside a focus zone can be moved")); return; }
    const target = groupId ? z.items.find((i) => i.group && i.id === groupId) : null;
    (target ? target.items : z.items).push(...moved);
    await this.saveSettings(); this.refreshAll();
  }
  createZone(name) {
    const z = { id: uid(), name, items: [] };
    this.settings.zones.push(z);
    this.settings.activeZone = z.id;
    return z.id;
  }
  promptNewZone() {
    new TextPromptModal(this.app, _t("New focus zone"), '', async (name) => {
      this.createZone(name); await this.saveSettings(); this.refreshAll();
    }).open();
  }
  promptRenameZone(z) {
    new TextPromptModal(this.app, _t("Rename focus zone"), z.name, async (name) => { z.name = name; await this.saveSettings(); this.refreshAll(); }).open();
  }
  deleteZone(z) {
    new ConfirmModal(this.app, _t("Delete focus zone \"{0}\"? (real files are not deleted)", z.name), async () => {
      const s = this.settings;
      s.zones = s.zones.filter((x) => x.id !== z.id);
      if (s.activeZone === z.id) s.activeZone = s.zones[0] ? s.zones[0].id : null;
      await this.saveSettings(); this.refreshAll();
    }).open();
  }
  zoneMenu(e, z) {
    const m = new Menu(), s = this.settings;
    m.addItem((i) => i.setTitle(_t("Rename")).setIcon('pencil').onClick(() => this.promptRenameZone(z)));
    m.addItem((i) => i.setTitle(_t("Move left")).setIcon('arrow-left').onClick(async () => {
      const k = s.zones.indexOf(z); if (k > 0) { [s.zones[k - 1], s.zones[k]] = [s.zones[k], s.zones[k - 1]]; await this.saveSettings(); this.refreshAll(); }
    }));
    m.addItem((i) => i.setTitle(_t("Move right")).setIcon('arrow-right').onClick(async () => {
      const k = s.zones.indexOf(z); if (k < s.zones.length - 1) { [s.zones[k + 1], s.zones[k]] = [s.zones[k], s.zones[k + 1]]; await this.saveSettings(); this.refreshAll(); }
    }));
    m.addSeparator();
    m.addItem((i) => i.setTitle(_t("Delete focus zone")).setIcon('trash').onClick(() => this.deleteZone(z)));
    m.showAtMouseEvent(e);
  }
  async addToZone(zoneId, files, mode, groupId) {
    const z = this.settings.zones.find((x) => x.id === zoneId);
    if (!z) return;
    const target = groupId ? z.items.find((i) => i.group && i.id === groupId) : null;
    const container = target ? target.items : z.items;
    for (const f of pruneNested(files)) {
      const incl = f instanceof TFolder ? mode === 'all' : true;
      let ex = null;
      for (const arr of this.zoneContainers(z)) { ex = arr.find((i) => !i.group && i.path === f.path); if (ex) break; }
      if (ex) ex.includeSub = incl; else container.push({ path: f.path, includeSub: incl });
    }
    this.settings.activeZone = zoneId;
    await this.saveSettings(); this.refreshAll();
    new Notice(_t("Added to \"{0}\"{1}", z.name, target ? ' › ' + target.name : ''));
  }
  async removeFromZone(paths) {
    const z = this.activeZoneObj();
    if (!z) return;
    const set = new Set(paths);
    for (const arr of this.zoneContainers(z)) {
      for (let i = arr.length - 1; i >= 0; i--) if (!arr[i].group && set.has(arr[i].path)) arr.splice(i, 1);
    }
    await this.saveSettings(); this.refreshAll();
  }

  /* ---- 開啟標記 ---- */
  computeOpen() {
    const open = new Set(), vis = new Set();
    this.app.workspace.iterateAllLeaves((leaf) => {
      let path = null;
      try { const st = leaf.getViewState(); path = st && st.state && st.state.file; } catch (e) { /* ignore */ }
      if (!path && leaf.view && leaf.view.file) path = leaf.view.file.path;
      if (typeof path !== 'string') return;
      open.add(path);
      try { if (leaf.view.containerEl.isShown()) vis.add(path); } catch (e) { /* ignore */ }
    });
    this.openSet = open; this.visSet = vis;
    const af = this.app.workspace.getActiveFile();
    this.activePath = af ? af.path : null;
  }
  applyIndicator(span, file) {
    span.empty(); span.style.color = '';
    if (!(file instanceof TFile)) return;
    const s = this.settings;
    const mark = this.visSet.has(file.path) ? s.viewingMark : this.openSet.has(file.path) ? s.backgroundMark : null;
    if (!mark) return;
    this.setAnyIcon(span, mark.text);
    span.style.color = parseColor(mark.color, this.aliasMap);
  }

  /* ---- 路徑同步 ---- */
  onRename(file, oldPath) {
    const s = this.settings;
    const map = (p) => (p === oldPath ? file.path : p.startsWith(oldPath + '/') ? file.path + p.slice(oldPath.length) : p);
    s.pinned = s.pinned.map(map);
    if (this.nav) {
      this.nav.path = map(this.nav.path);
      this.nav.back = this.nav.back.map(map);
      this.nav.fwd = this.nav.fwd.map(map);
      s.explorerPath = this.nav.path;
    }
    const ns = {};
    for (const [k, v] of Object.entries(s.styles || {})) ns[map(k)] = v;
    s.styles = ns;
    s.zones.forEach((z) => this.zoneContainers(z).forEach((arr) => arr.forEach((it) => { if (!it.group) it.path = map(it.path); })));
    const mo = {};
    for (const [k, v] of Object.entries(s.manualOrder)) mo[map(k)] = v;
    const oldParent = parentPath(oldPath), oldName = oldPath.split('/').pop();
    const newParent = file.parent ? file.parent.path : '/';
    const arr = mo[oldParent];
    if (arr) {
      const i = arr.indexOf(oldName);
      if (i >= 0) { if (oldParent === newParent) arr[i] = file.name; else arr.splice(i, 1); }
    }
    s.manualOrder = mo;
    for (const m of Object.values(s.expanded)) {
      for (const k of Object.keys(m)) { const nk = map(k); if (nk !== k) { delete m[k]; m[nk] = true; } }
    }
    this.saveSoon();
  }
  onDelete(file) {
    const s = this.settings, p = file.path;
    const hit = (x) => x === p || x.startsWith(p + '/');
    s.pinned = s.pinned.filter((x) => !hit(x));
    if (this.nav && this.nav.path !== '/' && hit(this.nav.path)) { this.nav.path = parentPath(p); s.explorerPath = this.nav.path; }
    for (const k of Object.keys(s.styles || {})) if (hit(k)) delete s.styles[k];
    s.zones.forEach((z) => this.zoneContainers(z).forEach((arr) => { for (let i = arr.length - 1; i >= 0; i--) if (!arr[i].group && hit(arr[i].path)) arr.splice(i, 1); }));
    for (const k of Object.keys(s.manualOrder)) if (hit(k)) delete s.manualOrder[k];
    const arr = s.manualOrder[parentPath(p)];
    if (arr) { const i = arr.indexOf(file.name); if (i >= 0) arr.splice(i, 1); }
    this.saveSoon();
  }
}

/* ------------------------------ 設定頁 ------------------------------ */
class FFMSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const el = this.containerEl, p = this.plugin, s = p.settings;
    el.empty();
    const save = async () => { await p.saveSettings(); p.refreshAll(); };
    const heading = (t) => new Setting(el).setName(t).setHeading();
    const toggle = (name, desc, get, set) => new Setting(el).setName(name).setDesc(desc || '')
      .addToggle((t) => t.setValue(get()).onChange(async (v) => { set(v); await save(); }));

    const iconInput = (st, get, set, placeholder) => {
      st.settingEl.addClass('ffm-wide-setting');
      let comp;
      st.addText((t) => { comp = t; t.setPlaceholder(placeholder || _t("Icon name / emoji")).setValue(get()).onChange(async (v) => { set(v.trim()); upd(); await save(); }); });
      const preview = st.controlEl.createSpan({ cls: 'ffm-mark-preview' });
      const upd = () => p.setAnyIcon(preview, get());
      st.addExtraButton((b) => b.setIcon('layout-grid').setTooltip(_t("Choose icon")).onClick(() =>
        new IconPickerModal(this.app, p, get(), async (v) => { set(v); comp.setValue(v); upd(); await save(); }).open()));
      upd();
    };
    heading(_t("Language"));
    new Setting(el).setName(_t("Interface language")).setDesc(_t("Follows the system (Obsidian) language by default; English is used if the language is not available. Japanese and Simplified Chinese are machine translations and may be inaccurate. Command names update after reloading the plugin."))
      .addDropdown((d) => {
        d.addOption('auto', _t("Follow system"));
        LANG_BUILTIN.forEach(([code, name]) => d.addOption(code, name));
        s.customLangs.forEach((l) => d.addOption('custom:' + l.name, l.name));
        d.setValue(s.language || 'auto');
        d.onChange(async (v) => { s.language = v; p.applyLanguage(); await save(); this.display(); });
      });
    new Setting(el).setName(_t("Language file path")).setDesc(_t("Relative path = a file in the vault; on desktop you can also enter a full path. The exported JSON uses English as the default template: edit the translations inside \"strings\", then import it. Imported languages are listed by file name after the built-in languages."))
      .addText((t2) => t2.setPlaceholder('Focus File Manager/lang/en.json').setValue(s.langPath || '').onChange(async (v) => { s.langPath = v.trim(); await p.saveSettings(); }));
    new Setting(el).setName(_t("Export / import language"))
      .addButton((b) => b.setButtonText(_t("Export English template")).onClick(() => p.exportLanguage(s.langPath, 'en')))
      .addButton((b) => b.setButtonText(_t("Export current language")).onClick(() => p.exportLanguage(s.langPath, 'current')))
      .addButton((b) => b.setButtonText(_t("Import")).setCta().onClick(async () => { await p.importLanguage(s.langPath); this.display(); }));
    if (s.customLangs.length) {
      let delName = s.customLangs[0].name;
      new Setting(el).setName(_t("Manage imported languages"))
        .addDropdown((d) => { s.customLangs.forEach((l) => d.addOption(l.name, l.name)); d.setValue(delName); d.onChange((v) => (delName = v)); })
        .addButton((b) => b.setButtonText(_t("Remove")).setWarning().onClick(async () => { await p.removeLanguage(delName); this.display(); }));
    }

    heading(_t("Behavior"));
    new Setting(el).setName(_t("File manager style")).setDesc(_t("Default: tree (expandable subfolders). Explorer: path bar on top, one level at a time, click a folder to enter it (focus zones are unaffected)"))
      .addDropdown((d) => {
        d.addOption('tree', _t("Default (tree)")); d.addOption('explorer', _t("Explorer (level by level)"));
        d.setValue(s.treeStyle || 'tree');
        d.onChange(async (v) => { s.treeStyle = v; await save(); });
      });
    new Setting(el).setName(_t("Sort order")).setDesc(_t("You can also switch with the sort button on the toolbar. For time-based sorting, a folder uses the time of the newest (modified) or oldest (created) file inside it"))
      .addDropdown((d) => {
        Object.keys(SORT_MODES).forEach((k) => d.addOption(k, _t(SORT_MODES[k])));
        d.setValue(s.sortMode || 'default');
        d.onChange(async (v) => { s.sortMode = v; await save(); });
      });
    toggle(_t("Folders before files when sorting"), _t("On by default (same as Obsidian)"), () => s.sortFoldersFirst !== false, (v) => (s.sortFoldersFirst = v));
    toggle(_t("Exclude items from \"Expand all / Collapse all\""), _t("When enabled, folders matching the list below are not affected by Expand all or Collapse all and keep their current state"), () => s.expandExcludeOn, (v) => (s.expandExcludeOn = v));
    new Setting(el).setName(_t("Exclusion list")).setDesc(_t("One per line. A name only (e.g. Attachments) = any folder with that name; a path (e.g. Projects/Archive) = the folder at that path. Wildcards * and ? are supported"))
      .addTextArea((t2) => { t2.setPlaceholder('Attachments\nProjects/Archive\n*.assets').setValue(s.expandExclude || '').onChange(async (v) => { s.expandExclude = v; await p.saveSettings(); }); t2.inputEl.rows = 3; t2.inputEl.style.width = '100%'; });
    new Setting(el).setName(_t("Top view-mode button style")).setDesc(_t("\"File manager / Focus zone / Both\": separate buttons, or one merged icon button that cycles"))
      .addDropdown((d) => {
        d.addOption('separate', _t("Separate buttons")); d.addOption('cycle', _t("Cycle button (merged)"));
        d.setValue(s.modeButtonStyle || 'separate');
        d.onChange(async (v) => { s.modeButtonStyle = v; await save(); });
      });
    new Setting(el).setName(_t("Top button appearance")).setDesc(_t("Use icons like Obsidian's built-in file explorer (description shown on hover), icons with text, or plain text"))
      .addDropdown((d) => {
        d.addOption('text', _t("Text buttons")); d.addOption('icon', _t("Icon buttons (description as tooltip)")); d.addOption('icon-text', _t("Icon + text label"));
        d.setValue(s.toolbarStyle || 'text');
        d.onChange(async (v) => { s.toolbarStyle = v; await save(); });
      });
    toggle(_t("Merge \"Collapse all / Expand all\" into one button"), _t("Like the built-in file explorer: the button reads \"Collapse all\" when something is expanded, otherwise \"Expand all\""), () => s.mergeExpandCollapse, (v) => (s.mergeExpandCollapse = v));
    toggle(_t("Clicking a folder does not expand/collapse"), _t("When enabled, only the arrow beside a folder expands or collapses it"), () => s.folderArrowOnly, (v) => (s.folderArrowOnly = v));
    toggle(_t("Single click does not open files"), _t("When enabled, a single click only selects; an open icon appears beside files, and you click it to open"), () => s.openViaButton, (v) => (s.openViaButton = v));
    new Setting(el).setName(_t("How files open")).setDesc(_t("Applies to single-click open, the right-click \"Open\" and the open icon"))
      .addDropdown((d) => {
        d.addOption('current', _t("Open in current tab")); d.addOption('tab', _t("Open in new tab"));
        d.setValue(s.openMode || 'current');
        d.onChange(async (v) => { s.openMode = v; await save(); });
      });
    toggle(_t("Show an \"open in new tab\" icon beside the open icon"), _t("Only shown when the previous option is \"Open in current tab\""), () => s.showTabButton !== false, (v) => (s.showTabButton = v));
    [['open', _t("Open icon color"), _t("Open icon opacity")], ['tab', _t("\"Open in new tab\" icon color"), _t("\"Open in new tab\" icon opacity")]].forEach(([k, colorName, opacityName]) => {
      new Setting(el).setName(colorName).setDesc(_t("Leave empty for the default color. Accepts color names, RGB or HEX"))
        .addText((t2) => t2.setPlaceholder(_t("Default color")).setValue(s[k + 'IconColor'] || '').onChange(async (v) => { s[k + 'IconColor'] = v.trim(); await save(); }))
        .addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip(_t("Reset")).onClick(async () => { s[k + 'IconColor'] = ''; await save(); this.display(); }));
      new Setting(el).setName(opacityName).setDesc(_t("100% = opaque"))
        .addSlider((sl) => sl.setLimits(10, 100, 5).setValue(Number(s[k + 'IconOpacity']) || 100).setDynamicTooltip().onChange(async (v) => { s[k + 'IconOpacity'] = v; await save(); }))
        .addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip(_t("Reset")).onClick(async () => { s[k + 'IconOpacity'] = 100; await save(); this.display(); }));
    });
    new Setting(el).setName(_t("New tab position")).setDesc(_t("Used by the right-click \"Open in new tab to the right\" and the new-tab icon"))
      .addDropdown((d) => {
        d.addOption('adjacent', _t("Next to the current tab (default)")); d.addOption('end', _t("At the end of the tabs"));
        d.setValue(s.newTabPosition || 'adjacent');
        d.onChange(async (v) => { s.newTabPosition = v; await save(); });
      });
    toggle(_t("Show times on hover"), _t("Hover over a file or folder to see its last modified and created times (also available via right-click \"Properties\")"), () => s.hoverInfo !== false, (v) => (s.hoverInfo = v));
    toggle(_t("Dim other levels while dragging when cross-level move is off"), _t("While dragging, items not on the same level are dimmed"), () => s.dimOtherLevels !== false, (v) => (s.dimOtherLevels = v));
    new Setting(el).setName(_t("Dim level")).setDesc(_t("The value is the visibility (%) of other-level items; lower is dimmer"))
      .addSlider((sl) => sl.setLimits(5, 90, 5).setValue(Number(s.dimOpacity) || 35).setDynamicTooltip().onChange(async (v) => { s.dimOpacity = v; await save(); }));
    new Setting(el).setName(_t("Double-click interval (ms)")).setDesc(_t("Two clicks closer than this count as a double-click (rename). When the previous option is off, opening a file by single click is delayed by this long"))
      .addText((t) => t.setValue(String(s.doubleClickMs || 300)).onChange(async (v) => { s.doubleClickMs = Math.max(100, Number(v) || 300); await p.saveSettings(); }));
    new Setting(el).setName(_t("Folder scope when dragging into a focus zone"))
      .addDropdown((d) => {
        d.addOption('all', _t("Include all sublevels")); d.addOption('level', _t("Current level files only"));
        d.setValue(s.dragAddMode || 'all');
        d.onChange(async (v) => { s.dragAddMode = v; await p.saveSettings(); });
      });

    heading(_t("Displayed info"));
    toggle(_t("Folders: show file count"), '', () => s.show.folderFileCount, (v) => (s.show.folderFileCount = v));
    toggle(_t("Folders: show subfolder count"), '', () => s.show.folderSubCount, (v) => (s.show.folderSubCount = v));
    toggle(_t("Counts include all sublevels (recursive)"), _t("When off, only the current level is counted"), () => s.countRecursive, (v) => (s.countRecursive = v));
    new Setting(el).setName(_t("Extensions counted as files")).setDesc(_t("Comma-separated, e.g. md,png,pdf; use * for all"))
      .addText((t) => t.setValue(s.countExtensions).onChange(async (v) => { s.countExtensions = v; await save(); }));
    toggle(_t("Files: show extension"), '', () => s.show.extension, (v) => (s.show.extension = v));
    toggle(_t("Files: show created time"), '', () => s.show.ctime, (v) => (s.show.ctime = v));
    toggle(_t("Files: show size"), '', () => s.show.size, (v) => (s.show.size = v));
    new Setting(el).setName(_t("File info position")).setDesc(_t("Where the extension, created time, size and folder counts are placed"))
      .addDropdown((d) => {
        d.addOption('inline', _t("All after the file name"));
        d.addOption('below', _t("All below the file name (.md date size)"));
        d.addOption('hybrid', _t("Extension after the name; created time and size below"));
        d.setValue(s.metaLayout || 'inline');
        d.onChange(async (v) => { s.metaLayout = v; await save(); });
      });
    new Setting(el).setName(_t("Size format")).setDesc(_t("Default: automatic unit (B / KB / MB…). Custom: choose the unit, decimals and base"))
      .addDropdown((d) => {
        d.addOption('default', _t("Default")); d.addOption('custom', _t("Custom"));
        d.setValue(s.sizeMode || 'default');
        d.onChange(async (v) => { s.sizeMode = v; await save(); this.display(); });
      });
    if (s.sizeMode === 'custom') {
      new Setting(el).setName(_t("Unit")).addDropdown((d) => {
        ['auto', 'B', 'KB', 'MB', 'GB'].forEach((u) => d.addOption(u, u === 'auto' ? _t("Auto") : u));
        d.setValue(s.sizeUnit || 'auto');
        d.onChange(async (v) => { s.sizeUnit = v; await save(); });
      });
      new Setting(el).setName(_t("Decimal places")).addText((t) => t.setValue(String(s.sizeDecimals ?? 1)).onChange(async (v) => { s.sizeDecimals = Math.max(0, Math.min(6, Number(v) || 0)); await save(); }));
      new Setting(el).setName(_t("Base")).addDropdown((d) => {
        d.addOption('1024', _t("1024 (KiB style)")); d.addOption('1000', _t("1000 (SI style)"));
        d.setValue(String(s.sizeBase || 1024));
        d.onChange(async (v) => { s.sizeBase = Number(v); await save(); });
      });
    }
    toggle(_t("Show full folder names"), _t("When off, names that don't fit are truncated with \"…\" (off by default)"), () => s.fullNameFolder, (v) => (s.fullNameFolder = v));
    toggle(_t("Show full file names"), _t("When off, names that don't fit are truncated with \"…\" (off by default)"), () => s.fullNameFile, (v) => (s.fullNameFile = v));
    toggle(_t("Wrap full names to the sidebar width"), _t("On (default): names wrap to the available width. Off: names stay on one line and can be scrolled sideways. Only applies when the two options above are on"), () => s.fullNameWrap !== false, (v) => (s.fullNameWrap = v));

    heading(_t("Appearance & theme compatibility"));
    new Setting(el).setDesc(_t("The list uses Obsidian's native style classes and the data-path attribute, so themes and CSS snippets usually apply directly. You can replace the symbols below; icons accept Lucide icon names, icon IDs registered by other plugins, or emoji/text. Set per-item icons and colors via right-click \"Appearance\"."));
    toggle(_t("Use Obsidian's native style classes"), _t("Compatible with themes and CSS snippets; turn off if the layout looks wrong"), () => s.nativeClasses !== false, (v) => (s.nativeClasses = v));
    toggle(_t("Show indent guides"), _t("Show a line to the left of child items when a folder is expanded (on by default)"), () => s.indentGuides !== false, (v) => (s.indentGuides = v));
    new Setting(el).setName(_t("Indent guide color")).setDesc(_t("Leave empty to follow the theme. Accepts color names, RGB or HEX"))
      .addText((t) => t.setPlaceholder(_t("Follow theme")).setValue(s.guideColor || '').onChange(async (v) => { s.guideColor = v.trim(); await save(); }))
      .addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip(_t("Reset (follow theme)")).onClick(async () => { s.guideColor = ''; await save(); this.display(); }));
    new Setting(el).setName(_t("Indent guide opacity")).setDesc(_t("100% = opaque"))
      .addSlider((sl) => sl.setLimits(5, 100, 5).setValue(Number(s.guideOpacity) || 100).setDynamicTooltip().onChange(async (v) => { s.guideOpacity = v; await save(); }))
      .addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip(_t("Reset")).onClick(async () => { s.guideOpacity = 100; await save(); this.display(); }));
    new Setting(el).setName(_t("Indent guide thickness (px)"))
      .addSlider((sl) => sl.setLimits(1, 6, 1).setValue(Number(s.guideWidth) || 1).setDynamicTooltip().onChange(async (v) => { s.guideWidth = v; await save(); }))
      .addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip(_t("Reset")).onClick(async () => { s.guideWidth = 1; await save(); this.display(); }));
    new Setting(el).setName(_t("Indent guide style template")).setDesc(_t("Choosing a template overwrites the line style, color, opacity, thickness, indent distance and advanced CSS below"))
      .addDropdown((d) => {
        d.addOption('', _t("(Choose a template…)"));
        GUIDE_TEMPLATES.forEach((x, i) => d.addOption('b' + i, _t("Template: {0}", _t(x.name)) + (x.description ? ' (' + _t(x.description) + ')' : '')));
        s.guideStyles.forEach((x, i) => d.addOption('u' + i, _t("Custom: {0}", x.name)));
        d.setValue('');
        d.onChange(async (v) => {
          if (!v) return;
          const st = v[0] === 'b' ? GUIDE_TEMPLATES[Number(v.slice(1))] : s.guideStyles[Number(v.slice(1))];
          if (st) { await p.applyGuideStyle(normalizeGuideStyle(st)); this.display(); }
        });
      });
    new Setting(el).setName(_t("Indent guide line style"))
      .addDropdown((d) => {
        GUIDE_LINES.forEach((k) => d.addOption(k, _t(GUIDE_LINE_NAMES[k])));
        d.setValue(GUIDE_LINES.includes(s.guideLine) ? s.guideLine : 'solid');
        d.onChange(async (v) => { s.guideLine = v; await save(); });
      });
    new Setting(el).setName(_t("Indent distance (px)")).setDesc(_t("How far each level of children is indented to the right"))
      .addSlider((sl) => sl.setLimits(0, 40, 1).setValue(s.guideOffset === undefined ? 12 : Number(s.guideOffset) || 0).setDynamicTooltip().onChange(async (v) => { s.guideOffset = v; await save(); }))
      .addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip(_t("Reset")).onClick(async () => { s.guideOffset = 12; await save(); this.display(); }));
    new Setting(el).setName(_t("Advanced: custom CSS declarations")).setDesc(_t("Only property declarations are accepted (e.g. box-shadow: …;). Use var(--ffm-guide-final) to get the final color after color and opacity are applied. For safety, url(), @-rules and braces are not allowed"))
      .addTextArea((t) => { t.setValue(s.guideCss || '').onChange(async (v) => { s.guideCss = v; await save(); }); t.inputEl.rows = 3; t.inputEl.style.width = '100%'; });
    new Setting(el).setName(_t("Style name")).setDesc(_t("Written to the file on export; after import it also appears in the template list under this name"))
      .addText((t) => t.setValue(s.guideStyleName || '').onChange(async (v) => { s.guideStyleName = v; await p.saveSettings(); }));
    new Setting(el).setName(_t("Export / import path")).setDesc(_t("Relative path = a file in the vault; on desktop you can also enter a full path (e.g. D:\\\\styles\\\\guide.json). Folders are created automatically on export"))
      .addText((t) => t.setPlaceholder('Focus File Manager/guide-style.json').setValue(s.guideStylePath || '').onChange(async (v) => { s.guideStylePath = v.trim(); await p.saveSettings(); }));
    new Setting(el).setName(_t("Export / import")).setDesc(_t("\"Export template reference\" writes guide-style-templates.json to the same folder, containing all built-in templates, as a reference for custom styles"))
      .addButton((b) => b.setButtonText(_t("Export current style")).onClick(() => p.exportGuideStyle(s.guideStylePath)))
      .addButton((b) => b.setButtonText(_t("Export template reference")).onClick(() => p.exportGuideTemplates(s.guideStylePath)))
      .addButton((b) => b.setButtonText(_t("Import")).setCta().onClick(async () => { await p.importGuideStyle(s.guideStylePath); this.display(); }));
    if (s.guideStyles.length) {
      let delIdx = 0;
      new Setting(el).setName(_t("Manage imported styles"))
        .addDropdown((d) => { s.guideStyles.forEach((x, i) => d.addOption(String(i), x.name)); d.setValue('0'); d.onChange((v) => (delIdx = Number(v))); })
        .addButton((b) => b.setButtonText(_t("Delete")).setWarning().onClick(async () => { s.guideStyles.splice(delIdx, 1); await p.saveSettings(); this.display(); }));
    }
    new Setting(el).setName(_t("Display text size")).setDesc(_t("Default: follow Obsidian. Custom: set the list text size (px)"))
      .addDropdown((d) => {
        d.addOption('follow', _t("Follow Obsidian (default)")); d.addOption('custom', _t("Custom"));
        d.setValue(s.fontMode || 'follow');
        d.onChange(async (v) => { s.fontMode = v; await save(); this.display(); });
      });
    if (s.fontMode === 'custom') {
      new Setting(el).setName(_t("Text size (px)"))
        .addSlider((sl) => sl.setLimits(9, 24, 1).setValue(Number(s.fontSize) || 13).setDynamicTooltip().onChange(async (v) => { s.fontSize = v; await save(); }));
    }
    iconInput(new Setting(el).setName(_t("Pin icon")).setDesc(_t("Shown beside pinned items")), () => s.pinIcon || 'pin', (v) => { s.pinIcon = v || 'pin'; });
    toggle(_t("Show bookmark marks"), _t("Synced with Obsidian bookmarks; bookmarked items get a mark beside them"), () => s.showBookmarkMark !== false, (v) => (s.showBookmarkMark = v));
    iconInput(new Setting(el).setName(_t("Bookmark icon")), () => s.bookmarkIcon || 'bookmark', (v) => { s.bookmarkIcon = v || 'bookmark'; });
    new Setting(el).setName(_t("Other file types for right-click \"New\"")).setDesc(_t("Base and Canvas are built in; Excalidraw also appears if the plugin is enabled. Other types: one per line in the format Name|extension|initial content (\\n = line break)"))
      .addTextArea((t) => { t.setValue(s.newFileTypes).onChange(async (v) => { s.newFileTypes = v; await save(); }); t.inputEl.rows = 3; });
    toggle(_t("Show icons beside folders"), _t("On by default"), () => s.showFolderIcon, (v) => (s.showFolderIcon = v));
    toggle(_t("Show icons beside files"), _t("On by default"), () => s.showFileIcon, (v) => (s.showFileIcon = v));
    new Setting(el).setName(_t("Icon source")).setDesc(_t("Some themes (e.g. Rathgar Gold) draw their own folder and file icons. Auto: use the theme's icons when detected to avoid duplicates; you can also force the theme's or the plugin's icons"))
      .addDropdown((d) => {
        d.addOption('auto', _t("Auto (detect theme)")); d.addOption('theme', _t("Use theme icons")); d.addOption('plugin', _t("Use plugin icons (customizable below)"));
        d.setValue(s.iconSource || 'auto');
        d.onChange(async (v) => { s.iconSource = v; await save(); });
      });
    new Setting(el).setName(_t("Expand / collapse arrow")).setDesc(_t("Auto: if the theme hides the expand arrow, it is hidden too (you can still click the folder row to expand); always shown when \"Clicking a folder does not expand/collapse\" is on"))
      .addDropdown((d) => {
        d.addOption('auto', _t("Auto (follow theme)")); d.addOption('show', _t("Always show")); d.addOption('hide', _t("Always hide"));
        d.setValue(s.arrowMode || 'auto');
        d.onChange(async (v) => { s.arrowMode = v; await save(); });
      });
    [['collapsed', _t("Collapsed arrow")], ['expanded', _t("Expanded arrow")], ['folder', _t("Folder icon")], ['folderOpen', _t("Folder icon (expanded)")], ['file', _t("File icon")]].forEach(([k, name]) => {
      iconInput(new Setting(el).setName(name), () => s.icons[k], (v) => { s.icons[k] = v; });
    });
    new Setting(el).setName(_t("File icons by extension")).setDesc(_t("One per line, format: extension=icon. E.g. md=file-text, png=image, pdf=📕"))
      .addTextArea((t) => { t.setValue(s.extIcons).onChange(async (v) => { s.extIcons = v; await save(); }); t.inputEl.rows = 4; });
    new Setting(el).addButton((b) => b.setButtonText(_t("Restore default icons")).onClick(async () => {
      s.icons = clone(DEFAULT_SETTINGS.icons); await save(); this.display();
    }));

    heading(_t("Hotkeys"));
    new Setting(el).setName(_t("View-mode hotkeys")).setDesc(_t("All empty by default. You can assign hotkeys to the four commands \"Show file manager only\", \"Show focus zone only\", \"Show both\" and \"Cycle view\"."))
      .addButton((b) => b.setButtonText(_t("Open hotkey settings")).onClick(() => {
        try {
          const st = this.app.setting;
          st.openTabById('hotkeys');
          const tab = st.activeTab;
          if (tab && tab.setQuery) tab.setQuery(p.manifest.name || 'Focus File Manager');
        } catch (e) { new Notice(_t("Go to \"Settings → Hotkeys\" and search for \"Focus File Manager\"")); }
      }));

    heading(_t("Open-file markers"));
    const markSetting = (name, desc, mark, def) => {
      const st = new Setting(el).setName(name).setDesc(desc);
      st.settingEl.addClass('ffm-wide-setting');
      let tText, tColor, preview;
      const upd = () => { p.setAnyIcon(preview, mark.text); preview.style.color = parseColor(mark.color, p.aliasMap); };
      st.addText((t) => { tText = t; t.setPlaceholder(_t("Symbol / icon name / emoji")).setValue(mark.text).onChange(async (v) => { mark.text = v; upd(); await save(); }); });
      preview = st.controlEl.createSpan({ cls: 'ffm-mark-preview' });
      st.addExtraButton((b) => b.setIcon('layout-grid').setTooltip(_t("Choose icon")).onClick(() =>
        new IconPickerModal(this.app, p, mark.text, async (v) => { mark.text = v; tText.setValue(v); upd(); await save(); }).open()));
      st.addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip(_t("Reset symbol")).onClick(async () => { mark.text = def.text; tText.setValue(def.text); upd(); await save(); }));
      st.addText((t) => { tColor = t; t.setPlaceholder(_t("Color")).setValue(mark.color).onChange(async (v) => { mark.color = v; upd(); await save(); }); });
      st.addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip(_t("Reset color")).onClick(async () => { mark.color = def.color; tColor.setValue(def.color); upd(); await save(); }));
      upd();
    };
    markSetting(_t("Currently displayed file"), _t("A file whose tab is in the foreground and visible on screen (default: dot). The first box takes a symbol, Lucide icon name or emoji (pick an icon with the button on the right); the second takes a color (red, 255,0,0 and #FF0000 all work)"), s.viewingMark, DEFAULT_SETTINGS.viewingMark);
    markSetting(_t("Open file (background tab)"), _t("A file that is open but whose tab is in the background (not currently shown) (default: square)"), s.backgroundMark, DEFAULT_SETTINGS.backgroundMark);
    new Setting(el).setName(_t("Custom color names")).setDesc(_t("One per line, format: name=color. E.g. \"vermilion=#ff4500\" or \"crimson=red\""))
      .addTextArea((t) => { t.setValue(s.colorAliases).onChange(async (v) => { s.colorAliases = v; await save(); }); t.inputEl.rows = 4; });

    heading(_t("Batch rename presets"));
    s.renamePresets.forEach((pr, idx) => {
      const card = el.createDiv({ cls: 'ffm-preset-card' });
      new Setting(card).setName(_t("Preset name")).addText((t) => t.setValue(_t(pr.name)).onChange(async (v) => { pr.name = v || _t("Untitled"); await p.saveSettings(); }))
        .addDropdown((d) => {
          d.addOption('pattern', _t("Name pattern / numbering")); d.addOption('replace', _t("Replace characters")); d.setValue(pr.type);
          d.onChange(async (v) => { pr.type = v; await p.saveSettings(); this.display(); });
        })
        .addExtraButton((b) => b.setIcon('trash').setTooltip(_t("Delete this preset")).onClick(async () => {
          if (s.renamePresets.length <= 1) { new Notice(_t("Keep at least one preset")); return; }
          s.renamePresets.splice(idx, 1); await p.saveSettings(); this.display();
        }));
      const text = (name, desc, key, num) => new Setting(card).setName(name).setDesc(desc || '')
        .addText((t) => t.setValue(String(pr[key])).onChange(async (v) => { pr[key] = num ? Number(v) || 0 : v; await p.saveSettings(); }));
      const tog = (name, key) => new Setting(card).setName(name)
        .addToggle((t) => t.setValue(!!pr[key]).onChange(async (v) => { pr[key] = v; await p.saveSettings(); }));
      if (pr.type === 'pattern') {
        text(_t("Name pattern"), _t("{n} number, {name} original name, {ext} extension, {i} order"), 'pattern');
        text(_t("Start number"), '', 'start', true); text(_t("Step"), '', 'step', true); text(_t("Zero-padding digits"), '', 'pad', true);
      } else {
        text(_t("Find"), '', 'find'); text(_t("Replace with"), '', 'replace');
        tog(_t("Use regular expression"), 'regex'); tog(_t("Case sensitive"), 'caseSensitive');
      }
    });
    new Setting(el).addButton((b) => b.setButtonText(_t("Add preset")).onClick(async () => {
      s.renamePresets.push({ id: uid(), name: _t("New preset"), type: 'pattern', pattern: '{n} {name}', start: 1, step: 1, pad: 2, find: '', replace: '', regex: false, caseSensitive: true });
      await p.saveSettings(); this.display();
    }));
  }
}

module.exports = FocusFileManagerPlugin;
