'use strict';
const obsidian = require('obsidian');
const { Plugin, ItemView, Menu, Notice, Modal, Setting, PluginSettingTab, TFile, TFolder, setIcon, debounce, Platform, parseYaml, stringifyYaml, getAllTags } = obsidian;
// 手機版沒有 Node 模組：以 try/catch 保護，跨庫剪貼簿只在桌面版可用
let fs = null, nodePath = null, os = null;
try { fs = require('fs'); nodePath = require('path'); os = require('os'); } catch (e) { /* mobile */ }
const HAS_NODE = !!(fs && nodePath && os);

const VIEW_TYPE = 'focus-file-manager-view';
const VIEW_TAGS = 'focus-file-manager-tags';
const VIEW_PROPS = 'focus-file-manager-props';
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
  leftMode: 'files', // files | tags | props
  tagPanel: { sort: 'name-asc', nested: false },
  tagCols: {},
  tagExpanded: {},
  tagMeta: {},
  tagFolders: [],
  tagOrder: [],
  tagCustom: [],
  tagDupThreshold: 80,
  tagColStyle: {},
  propColStyle: {},
  tagFilesOpen: {},
  tagColsTab: {},
  propColsTab: {},
  tagColStyleTab: {},
  propColStyleTab: {},
  sortFolderPos: 'top', // top | bottom | mixed-before | mixed-after
  propPanel: { sort: 'name-asc' },
  propCols: {},
  propExpanded: {},
  propOrder: [],
  propCustom: [],
  tagClickEdit: true,
  headerTitleLocate: true,
  propFolders: [],
  hiddenList: '',
  showExcluded: false,
  menuOrder: [],
  menuIcons: {},
  menuSepExplicit: false,
  menuHidden: [],
  yamlSchemes: [],
  batchCreateMax: 10,
  openOnEnable: true,
  highlightNew: true,
  highlightColor: '',
  locateNew: true,
  headerPathPrefer: true,
  dailyTemplates: '',
  dailyNameFormat: 'YYYY-MM-DD',
  showOpenIcon: true,
  openIconSticky: true,
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
    "List replace": "名單替換",
    "Drag the ⋮⋮ handle or use ↑ ↓ to change the order (numbering follows this order)": "拖動左邊的 ⋮⋮ 或按 ↑ ↓ 調整順序（編號會依照這個順序計算）",
    "Save as preset": "儲存為方案",
    "Apply": "套用",
    "Batch rename ({0} items)": "批量重新命名（{0} 個項目）",
    "Name pattern": "名稱格式",
    "Available: {n} number, {name} original name (without extension), {ext} extension, {i} order (1,2,3…)": "可用：{n} 序號、{name} 原名稱（不含副檔名）、{ext} 副檔名、{i} 順序(1,2,3…)",
    "Start number": "起始數字",
    "Step": "遞增",
    "Zero-padding digits": "補零位數",
    "0 means no padding": "0 代表不補零",
    "Name list": "名稱清單",
    "One name per line, applied in order to the files below (extensions are kept). Paste directly or import a text file": "每行一個名稱，依序套用到下面的檔案（副檔名會保留）。可直接貼上，或導入文字檔",
    "Import list…": "導入名單…",
    "Find": "尋找",
    "Replace with": "取代為",
    "Use regular expression": "使用正則表達式",
    "Case sensitive": "區分大小寫",
    "Failed to read the file: ": "讀取檔案失敗：",
    "Preset name": "方案名稱",
    "Saved preset \"{0}\"": "已儲存方案「{0}」",
    "Invalid name": "名稱不合法",
    "Duplicate name": "名稱重複",
    "An item with the same name already exists": "已存在同名項目",
    "\"{0}\" → \"{1}\": {2}": "「{0}」→「{1}」：{2}",
    "No items to rename": "沒有要重新命名的項目",
    "The list has {0} names but only {1} items: the extra {2} names will not be used (you can ignore this warning)": "名單有 {0} 個名稱，但只有 {1} 個項目：多出的 {2} 個名稱不會使用（可忽略此提示）",
    "The list has only {0} names but there are {1} items: the last {2} items keep their original names (you can ignore this warning)": "名單只有 {0} 個名稱，但有 {1} 個項目：後面 {2} 個項目會維持原名（可忽略此提示）",
    "Drag to reorder": "拖動調整順序",
    "Move up": "往上",
    "Move down": "往下",
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
    "Batch create": "批量創建",
    "Note": "筆記",
    "Folder": "文件夾",
    "Daily note (template)": "模板日記",
    "Daily note templates": "日記模板",
    "(Blank, no template)": "（空白，不使用模板）",
    "Count": "數量",
    "Up to {0} (adjustable in the plugin settings, maximum 50)": "最多 {0} 個（可在插件設定中調整，上限 50）",
    "Name prefix": "名稱前綴",
    "After creating, batch rename opens automatically so you can give them the names you want": "建立後會自動進入批量重新命名，可再改成想要的名稱",
    "Untitled": "未命名",
    "Create and batch rename": "建立並批量重新命名",
    "Please enter a valid count": "請輸入有效的數量",
    "You can create at most {0} at a time": "最多只能建立 {0} 個",
    "Create failed: ": "建立失敗：",
    "Created {0} items": "已建立 {0} 個項目",
    "Batch edit YAML ({0} files)": "批量修改 YAML（{0} 個檔案）",
    "(Load a preset…)": "（載入方案…）",
    "There are no operations to save": "沒有可儲存的操作",
    "{0} operation(s) with per-file values cannot be saved in a preset and were skipped": "有 {0} 個「獨立輸入」的操作無法存入方案，已略過",
    "Delete preset": "刪除方案",
    "Choose the preset to delete from the dropdown first": "請先在下拉選單選擇要刪除的方案",
    "Add property": "新增屬性",
    "Edit property": "編輯屬性",
    "Delete property": "刪除屬性",
    "Sort properties": "排序屬性",
    "Apply to": "套用範圍",
    "All selected files ({0})": "全部選取的檔案（{0}）",
    "Only some files…": "只套用到部分檔案…",
    "Sort target": "排序對象",
    "Order of properties": "屬性的順序",
    "Values of list properties": "清單屬性的值",
    "Sort order": "排序方式",
    "Ascending (A → Z)": "升冪（A → Z）",
    "Descending (Z → A)": "降冪（Z → A）",
    "Custom order": "自訂順序",
    "Custom property order": "自訂屬性順序",
    "Drag the ⋮⋮ handle or use ↑ ↓ to reorder; properties higher in the list come first": "拖動左邊的 ⋮⋮ 或按 ↑ ↓ 調整順序；排在上面的屬性會先出現",
    "Property name": "屬性名稱",
    "One property name per line; you can also write \"name=value\" to set the value directly": "每行一個屬性名稱；也可以寫成「名稱=值」直接指定值",
    "Leave empty = all list properties": "留空 = 全部清單屬性",
    "Value type": "值的類型",
    "Auto-detect": "自動判斷",
    "Text": "文字",
    "List (comma-separated)": "清單（以逗號分隔）",
    "Number": "數字",
    "Checkbox (true / false)": "核取方塊（true／false）",
    "Date": "日期",
    "Date and time": "日期與時間",
    "Value scope": "值套用範圍",
    "Follow the apply scope (enter it once)": "跟隨套用範圍（只需輸入一次）",
    "Enter each value separately (a different value per file)": "獨立輸入每個值（每個檔案各自的值）",
    "Today": "今天",
    "Now": "現在",
    "Value": "值",
    "If the property already exists": "屬性已存在時",
    "Skip": "略過",
    "Overwrite": "覆蓋",
    "Merge into a list": "合併為清單",
    "New property name": "新屬性名稱",
    "Leave empty = keep the name": "留空 = 不改名",
    "Value handling": "值的處理",
    "Keep the value": "維持原值",
    "Set to a new value": "設為新值",
    "Find and replace": "尋找並取代",
    "New value": "新值",
    "Delete only this value": "只刪除這個值",
    "Leave empty = delete the whole property. For list properties, only matching items are removed": "留空 = 刪除整個屬性。屬性是清單時，只移除符合的項目",
    "Convert (preview only, no files are changed)": "轉化（先預覽，不會修改檔案）",
    "A blank line or box = that file is left alone. Fill in one value per line (in the file order below) or type or pick a value in each file's box": "留空的行或框 = 不處理該檔案；可以每行填一個值（依下方檔案順序），也可以在每個檔案的框裡各別填寫或選取",
    "Set all to today": "全部設為今天",
    "Set all to now": "全部設為現在",
    "One value per line": "每行一個值",
    "{0} files, matched in the order below": "共 {0} 個檔案，依下方順序對應",
    "(There are no properties to sort yet)": "（目前沒有可排序的屬性）",
    "Existing values (click to use)": "現有的值（點擊使用）",
    "Existing properties (click to use)": "現有的屬性（點擊使用）",
    "Properties used elsewhere in the vault": "庫中其他檔案使用的屬性",
    "Please choose at least one file": "請至少選擇一個檔案",
    "Please enter at least one value": "請至少填寫一個值",
    "Please enter a property name first": "請先填寫屬性名稱",
    "\"Enter each value separately\" works with a single property name only": "「獨立輸入每個值」只能搭配單一屬性名稱",
    "Only {0} files": "僅 {0} 個檔案",
    "Add property {0} (a different value per file)": "新增屬性 {0}（各檔案各自的值）",
    "Add property {0} = {1}": "新增屬性 {0} = {1}",
    "Rename {0} to {1}": "將 {0} 改名為 {1}",
    "Set the value of {0} separately per file": "依各檔案分別設定 {0} 的值",
    "Set the value of {0} to {1}": "將 {0} 的值設為 {1}",
    "In the value of {0}, replace \"{1}\" with \"{2}\"": "在 {0} 的值中將「{1}」取代為「{2}」",
    "; ": "；",
    "Edit property {0}": "編輯屬性 {0}",
    "Delete a different value from {0} per file": "依各檔案分別刪除 {0} 中的值",
    "Delete the value {1} from {0}": "刪除 {0} 中的值 {1}",
    "Delete property {0}": "刪除屬性 {0}",
    "Sort the values of {0} ({1})": "排序 {0} 的值（{1}）",
    "Sort properties ({0})": "排序屬性（{0}）",
    "Pending operations ({0})": "待套用的操作（{0}）",
    "No operations yet. Fill in the form above and press \"Convert\".": "尚未新增任何操作。填寫上面的表單後按「轉化」。",
    "Edit this operation": "編輯此操作",
    "Remove this operation": "移除此操作",
    "Preview": "預覽",
    "Source": "原始碼",
    "Show only changed files": "只顯示有變更的檔案",
    "Invalid YAML, skipped": "YAML 格式有誤，已略過",
    "Changed": "有變更",
    "Unchanged": "無變更",
    "No matching files": "沒有符合的檔案",
    "(No properties)": "（沒有屬性）",
    "There are no operations to apply": "沒有待套用的操作",
    "Updated {0} files, skipped {1}": "已更新 {0} 個檔案，略過 {1} 個",
    "Updated {0} files": "已更新 {0} 個檔案",
    "List": "清單",
    "Checkbox": "核取方塊",
    "Tags": "標籤",
    "Aliases": "別名",
    "Tag name Z → A": "標籤名稱 Z → A",
    "Last used: newest first": "上次使用：最新使用",
    "Last used: oldest first": "上次使用：最舊使用",
    "Tag name A → Z": "標籤名稱 A → Z",
    "Sort: {0}": "排序：{0}",
    "Show nested tags": "顯示巢狀標籤",
    "Collapse all": "全部收合",
    "Expand all": "全部展開",
    "Search": "搜尋",
    "Search tags and their notes": "搜尋標籤與註釋",
    "Remove duplicate tags": "去除重複標籤",
    "Find similar tags and merge or delete them": "找出相似的標籤並合併或刪除",
    "Search tags and their notes…": "搜尋標籤與註釋…",
    "No.": "編號",
    "Status": "狀態",
    "Tag name": "標籤名稱",
    "Tag note": "標籤註釋",
    "Last used": "上次使用",
    "Locked (cannot be renamed, deleted or merged)": "已上鎖（無法重新命名、刪除、合併）",
    "Click to lock": "點擊上鎖",
    "Click to edit the note": "點擊編輯註釋",
    "(No tags)": "（沒有標籤）",
    "Rename folder": "重新命名文件夾",
    "Copied {0} tags": "已複製 {0} 個標籤",
    "Copy failed": "複製失敗",
    "Create tag": "創建標籤",
    "Search (include)": "搜尋（包含）",
    "Search (exclude)": "搜尋（排除）",
    "Add search condition (include)": "加入搜尋條件（包含）",
    "Add search condition (exclude)": "加入搜尋條件（排除）",
    "Run search ({0} conditions)": "執行搜尋（{0} 個條件）",
    "Clear search conditions": "清除搜尋條件",
    "Search conditions cleared": "已清除搜尋條件",
    "Copy tag names": "複製標籤名稱",
    "Copy tag names with #": "複製加#的標籤名稱",
    "Rename": "重新命名",
    "Exit selection mode": "取消選取狀態",
    "Enter selection mode": "進入選取狀態",
    "Select all": "全選",
    "Merge tags…": "合併標籤…",
    "Delete tags…": "刪除標籤…",
    "Lock / unlock": "上鎖／解鎖",
    "Create folder": "建立文件夾",
    "Add to folder…": "加入文件夾…",
    "Move out of folder": "移出文件夾",
    "Delete folder (tags are kept)": "刪除文件夾（標籤保留）",
    "Move up one level": "移到上一層",
    "Move down one level": "移到下一層",
    "Merge tags ({0})": "合併標籤（{0}）",
    "Tags to merge: {0}": "要合併的標籤：{0}",
    "Resulting tag name": "合併後的標籤名稱",
    "Enter an existing tag name = merge into that tag; enter a new name = rename, then merge": "輸入現有的標籤名稱＝合併到該標籤；輸入新的名稱＝重新命名後合併",
    "Merged tags in notes": "筆記中被合併的標籤",
    "Replace with the new tag name": "替換成新的標籤名稱",
    "Delete everything": "全部刪除",
    "Delete only the # (keep the text)": "只刪除 #（保留文字）",
    "Merge": "合併",
    "Please enter the resulting tag name": "請輸入合併後的標籤名稱",
    "Delete tags ({0})": "刪除標籤（{0}）",
    "This will affect {0} notes: {1}": "將影響 {0} 個筆記：{1}",
    "Tags in notes": "筆記中的標籤",
    "Delete": "刪除",
    "Finds tags with similar names. For each group, choose the tag to keep, then merge or delete the others.": "找出名稱相似的標籤。每組請選擇要保留的標籤，再選擇合併或刪除其餘的標籤。",
    "Similarity threshold (%)": "相似度門檻（%）",
    "A higher value lists only closer matches": "數值越高，只會列出越相近的標籤",
    "No similar tags found": "沒有找到相似的標籤",
    "Merge (keep the selected one)": "合併（保留單選的那個）",
    "Delete (the checked tags)": "刪除（勾選的標籤）",
    "Property name Z → A": "屬性名稱 Z → A",
    "Property name A → Z": "屬性名稱 A → Z",
    "Search properties": "搜尋屬性",
    "Search properties…": "搜尋屬性…",
    "Property type": "屬性類型",
    "Copied {0} properties": "已複製 {0} 個屬性",
    "Rename value": "重新命名值",
    "Delete value": "刪除值",
    "Delete the value \"{1}\" from property {0} in all notes?": "確定從所有筆記的屬性 {0} 中刪除值「{1}」？",
    "Delete these {0} properties? They will be removed from all notes.": "確定刪除這 {0} 個屬性？所有筆記中的這些屬性都會被移除。",
    "Copy property names": "複製屬性名稱",
    "Copy property type + name": "複製屬性類型＋名稱",
    "Copy properties (with values)": "複製屬性（含值）",
    "Add values…": "添加值…",
    "Create property": "創建屬性",
    "Delete folder (properties are kept)": "刪除文件夾（屬性保留）",
    "Rename properties ({0})": "重新命名屬性（{0}）",
    "Create": "創建",
    "Add values ({0} properties)": "添加值（{0} 個屬性）",
    "These values are added to every note that uses these properties (values that already exist are not added twice)": "會把這些值加入所有已使用這些屬性的筆記（已存在的值不會重複加入）",
    "Values to add": "要添加的值",
    "Append": "添加",
    "Move to": "移動到",
    "Enter or choose the destination folder path (created automatically if it does not exist; / means the vault root)": "輸入或選擇目標資料夾路徑（不存在時會自動建立；/ 代表庫根目錄）",
    "Matching files ({0})": "符合條件的檔案（{0}）",
    "Please enter the destination path first": "請先填寫目標路徑",
    "Moved {0} files, skipped {1}": "已移動 {0} 個檔案，略過 {1} 個",
    "Moved {0} files": "已移動 {0} 個檔案",
    "Move failed: ": "移動失敗：",
    "Move files by tags ({0} files)": "根據標籤移動文件（{0} 個檔案）",
    "Click a tag to cycle: include (green) → exclude (red) → unused": "點擊標籤切換：包含（綠）→ 排除（紅）→ 不使用",
    "(The selected files have no tags)": "（選取的檔案沒有標籤）",
    "How included tags are matched": "包含標籤的比對方式",
    "Must contain all selected tags": "必須包含所有選取的標籤",
    "Contains any selected tag": "包含任一選取的標籤",
    "Move": "移動",
    "Move files by YAML ({0} files)": "根據 YAML 移動文件（{0} 個檔案）",
    "Add conditions to filter files (all conditions must match). Date and date + time properties can use a range.": "加入條件來篩選檔案（所有條件需同時符合）。日期與日期＋時間類型的屬性可以使用範圍。",
    "+ Add condition": "＋ 新增條件",
    "Include": "包含",
    "Exclude": "排除",
    "Date range": "日期範圍",
    "Specific values": "指定的值",
    "Has the property": "有此屬性",
    "Remove condition": "移除條件",
    "From": "從",
    "To": "到",
    "Back": "上一頁",
    "Forward": "下一頁",
    "Up one level": "上一層",
    "\"Cross-level move\" is off; cannot move to another level": "「跨層級移動」已關閉，無法移到其他層級",
    "Path copied": "已複製路徑",
    "Copy path": "複製路徑",
    "Copy full path": "複製完整路徑",
    "Selection mode ({0} selected)": "選取模式（已選 {0}）",
    "Done": "結束選取",
    "Temp · {0}": "臨時 · {0}",
    "Pin to top": "置頂",
    "Bookmarked": "已加入書籤",
    "{0} files": "{0} 檔",
    "{0} folders": "{0} 夾",
    "Open": "開啟",
    "Rename temporary folder": "重新命名臨時文件夾",
    "Create temporary folder": "創建臨時文件夾",
    "Delete temporary folder (shortcuts move back to top level)": "刪除臨時文件夾（捷徑移回頂層）",
    "New focus zone": "新增專注區",
    "Rename this focus zone": "重新命名此專注區",
    "Delete this focus zone": "刪除此專注區",
    "Select all (including collapsed)": "全選（含未展開）",
    "New note": "新增筆記",
    "New folder": "新增文件夾",
    "New {0}": "新增 {0}",
    "Create daily note from template": "創建模板日記",
    "Batch create…": "批量創建…",
    "Paste to root": "貼上到根目錄",
    "Paste to current folder": "貼上到目前資料夾",
    "Select all (visible)": "全選（可見項目）",
    "Tag manager": "標籤管理",
    "Property manager": "屬性管理",
    "Focus File Manager": "專注文件管理器",
    "(This folder is empty)": "（此資料夾是空的）",
    "(The vault is empty)": "（庫是空的）",
    "Select files/folders on the left, then right-click \"Add to focus zone\"": "在左側選取文件／文件夾，右鍵「加入專注區」",
    "Right-click here to create a focus zone": "在此處按右鍵，新增一個專注區",
    "Reset manual order…": "重置手動排序…",
    "Reset the manual order? All manual ordering records will be cleared.": "確定要重置手動排序嗎？所有手動排序紀錄將被清除。",
    "Refresh": "重新整理",
    "Refresh (manually refresh open-file markers)": "重新整理（手動刷新開啟標記）",
    "Plugin settings": "插件設定",
    "Open plugin settings": "開啟插件設定",
    "Show: {0}": "顯示：{0}",
    "Click to switch: File manager → Focus zone → Both (current: {0})": "點擊切換：文件管理 → 專注區 → 兩者（目前：{0}）",
    "On": "開",
    "Off": "關",
    "Cross-level move: {0}": "跨層級移動：{0}",
    "Cross-level move (limits dragging): {0}": "跨層級移動（限制拖曳）：{0}",
    "Default": "預設",
    "Manual": "手動",
    "Sort order: {0}": "排序方式：{0}",
    "Shown": "顯示",
    "Hidden": "隱藏",
    "Excluded files: {0}": "排除的文件：{0}",
    "Click to show or hide excluded files and folders": "點擊切換顯示或隱藏被排除的文件與文件夾",
    "Collapse all (press again to switch to expand all)": "全部收合（再按一次切換為全部展開）",
    "Expand all (press again to switch to collapse all)": "全部展開（再按一次切換為全部收合）",
    "+": "＋",
    "Open Focus File Manager in sidebar": "在側邊欄開啟專注文件管理器",
    "Open Focus File Manager in main area": "在主區域開啟專注文件管理器",
    "Show file manager only": "只顯示文件管理",
    "Show focus zone only": "只顯示專注區",
    "Show both": "兩者同時顯示",
    "Cycle view (File manager → Focus zone → Both)": "切換顯示（文件管理 → 專注區 → 兩者）",
    "Open tag manager in a tab": "在分頁開啟標籤管理",
    "Open property manager in a tab": "在分頁開啟屬性管理",
    "Show tag manager in the left area": "在左側區域顯示標籤管理",
    "Show property manager in the left area": "在左側區域顯示屬性管理",
    "Show file manager in the left area": "在左側區域顯示文件管理",
    "Locate in Focus File Manager": "在專注文件管理器中定位",
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
    "\"{0}\" is already at the top level": "「{0}」已在最上層",
    "No folder above \"{0}\" to move it into": "「{0}」上方沒有可放入的文件夾",
    "The name contains invalid characters": "名稱含有不合法字元",
    "Delete {0} items? (moved to trash per Obsidian settings)": "確定刪除 {0} 個項目？（依 Obsidian 設定移到垃圾桶）",
    "Delete failed: ": "刪除失敗：",
    "Canvas": "畫布",
    "Excalidraw plugin not found; make sure it is enabled": "找不到 Excalidraw 插件，請確認已啟用",
    "Failed to create Excalidraw: ": "建立 Excalidraw 失敗：",
    "This file is excluded (hidden); show excluded files first": "此文件已被排除（隱藏），請先顯示被排除的文件",
    "Open this plugin's settings under \"Settings → Community plugins\"": "請到「設定 → 第三方插件」開啟本插件的設定",
    "Today's note already exists: {0}": "今日日記已存在：{0}",
    "Daily note created: {0}": "已建立日記：{0}",
    "Blank daily note (no template)": "空白日記（不使用模板）",
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
    "This item is hidden by the exclusion rule \"{0}\"; change it in the settings": "此項目由排除規則「{0}」隱藏，請到設定中修改",
    "Open in new tab": "在新分頁開啟",
    "Open to the right": "在右側開啟",
    "Open in new window": "在新視窗開啟",
    "Show in folder": "在資料夾中顯示",
    "Selection mode (enter / exit)": "選取狀態（進入／取消）",
    "Add to focus zone…": "加入專注區…",
    "Remove from focus zone": "從專注區移除",
    "Remove from focus zone ({0})": "從專注區移除（{0}）",
    "Move to temporary folder…": "移到臨時文件夾…",
    "Move out of temporary folder": "移出臨時文件夾",
    "Copy": "複製",
    "Cut": "剪下",
    "Paste": "貼上",
    "Add / remove bookmark": "加入／移除書籤",
    "Remove bookmark": "移除書籤",
    "Add bookmark": "加入書籤",
    "Batch rename…": "批量重新命名…",
    "Batch rename… ({0})": "批量重新命名…（{0}）",
    "Batch rename files inside folder…": "批量重新命名資料夾內的檔案…",
    "This folder has no files": "此資料夾內沒有檔案",
    "Batch edit YAML…": "批量修改 YAML…",
    "Move files by tags…": "根據標籤移動文件…",
    "Move files by YAML…": "根據 YAML 移動文件…",
    "Appearance (icon / color)…": "外觀（圖示／顏色）…",
    "Unpin": "取消置頂",
    "Move down one level (into the previous folder)": "移到下一層（放入上一個文件夾）",
    "Hide / unhide (exclude)": "隱藏／取消隱藏（排除）",
    "Unhide (remove exclusion)": "取消隱藏（移出排除）",
    "Hide (add exclusion)": "隱藏（加入排除）",
    "New note here": "在此新增筆記",
    "New folder here": "在此新增文件夾",
    "New other file types here (Base, Canvas…)": "在此新增其他檔案類型（Base、畫布…）",
    "New {0} here": "在此新增 {0}",
    "Properties…": "屬性…",
    "Tag #{0} is locked and cannot be renamed, deleted or merged": "標籤 #{0} 已上鎖，無法重新命名、刪除或合併",
    "Invalid tag name (it cannot contain spaces or #)": "標籤名稱不合法（不可包含空白或 #）",
    "The core Search plugin is not available": "找不到可用的核心外掛「搜尋」",
    "Search condition added ({0} in total)": "已加入搜尋條件（共 {0} 個）",
    "There is no folder above to move it into": "上方沒有可放入的文件夾",
    "This version of Obsidian does not support setting property types from a plugin": "此版本的 Obsidian 不支援從插件設定屬性類型",
    "Set the type of {0} properties": "已設定 {0} 個屬性的類型",
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
    "Search settings…": "搜尋設定…",
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
    "When enabled, a single click only selects; open files with the open icons below (or the right-click menu)": "啟用後，單擊只會選取；請搭配下方的開啟符號（或右鍵選單）來開啟文件",
    "How files open": "開啟文件的方式",
    "Applies to single-click open, the right-click \"Open\" and the open icon": "套用於單擊開啟、右鍵「開啟」與開啟符號",
    "Open in current tab": "在目前分頁開啟",
    "Show open icon": "顯示開啟符號",
    "Show an \"Open\" icon beside each file (on by default)": "在每個檔案旁顯示「開啟」符號（預設開啟）",
    "Show \"open in new tab to the right\" icon": "顯示「在右側新分頁開啟」符號",
    "Show an \"open in new tab to the right\" icon beside each file (on by default). If \"How files open\" is set to new tab, only one icon is shown": "在每個檔案旁顯示「在右側新分頁開啟」符號（預設開啟）。若「開啟文件的方式」為新分頁，則只顯示一個符號",
    "Open icons follow the sidebar": "開啟符號跟隨側邊欄移動",
    "The icons stay pinned to the right edge of the visible area, so long file names never push them out of the sidebar (on by default)": "開啟符號會固定在可見範圍的右側，不會被過長的檔名擠出側邊欄之外（預設開啟）",
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
    "Highlight new items": "新增項目後高亮",
    "After creating a note, folder, etc. from the menu, the new item's background is briefly highlighted (on by default)": "右鍵新增筆記、文件夾等之後，新項目的背景會短暫高亮（預設開啟）",
    "Highlight color": "高亮顏色",
    "Leave empty to use the theme's accent color. Accepts color names, RGB or HEX": "留空 = 使用主題的強調色。可填顏色名稱、RGB、HEX",
    "Follow theme": "跟隨主題",
    "Reset (follow theme)": "重置（跟隨主題）",
    "Locate new items": "新增項目後定位到該項目",
    "Automatically expands parent folders and scrolls to the new item (on by default)": "自動展開上層文件夾並捲動到新項目的位置（預設開啟）",
    "Open in the left sidebar when the plugin is enabled": "啟用插件時自動在左側欄開啟",
    "When you enable this plugin manually inside Obsidian, Focus File Manager opens in the left sidebar automatically (on by default)": "在 Obsidian 裡手動啟用本插件時，會自動在左側邊欄開啟專注文件管理器（預設開啟）",
    "Maximum for batch create": "批量創建的最大數量",
    "The most items one batch create can make. Default 10, maximum 50": "單次批量創建文件的上限。預設 10，最高 50",
    "Show excluded files": "顯示被排除的文件",
    "Hidden by default. You can also toggle it with the eye button on the toolbar": "預設隱藏。也可以用工具列的眼睛按鈕切換",
    "Exclusion list (hidden files / folders)": "排除清單（隱藏的文件／文件夾）",
    "One per line. Starting with / or containing / means a path (e.g. /Projects/Archive); otherwise it is a name (any item with that name). Wildcards * and ? work. \"Hide\" in the right-click menu writes here automatically": "每行一個。以 / 開頭或含有 / 的是路徑（例如 /Projects/Archive），否則是名稱（任何位置的同名項目）。可用 * 與 ?。右鍵選單的「隱藏」會自動寫入這裡",
    "Tags in notes: single click edits, double click searches": "筆記中的標籤：單擊直接編輯，雙擊才搜尋",
    "When on (default), a single click on a tag (#tag) in a note does not jump to Obsidian's search so you can edit it directly; a double click searches for the tag": "啟用後（預設開啟），單擊筆記中的標籤（#標籤）不會跳轉到 Obsidian 的搜尋，可以直接編輯；雙擊才會搜尋該標籤",
    "Locate the file when clicking the file name under the tab bar": "點擊分頁欄下方的檔名時定位該文件",
    "A single click on the file name locates and highlights the file in this plugin; a double click starts renaming (on by default)": "單擊檔名會在本插件中定位並高亮該文件；雙擊則進入重新命名（預設開啟）",
    "Prefer this plugin when clicking the path under the tab bar": "點擊分頁欄下方的路徑時優先使用本插件",
    "When you click a folder name in the path above a note's title, this plugin locates and shows that folder (on by default)": "點擊筆記標題上方的路徑（資料夾名稱）時，改由本插件定位並顯示該資料夾（預設開啟）",
    "Daily note template paths": "日記模板路徑",
    "One path per line; each can be a template file or a folder (every .md inside a folder is listed as a template). Supports {{date}}, {{date:FORMAT}}, {{time}} and {{title}}": "每行一個路徑，可以是模板檔案或資料夾（資料夾內所有 .md 都會列為模板）。支援 {{date}}、{{date:格式}}、{{time}}、{{title}}",
    "Daily note file name format": "日記檔名格式",
    "Uses moment.js format tokens; default YYYY-MM-DD": "使用 moment 格式，預設 YYYY-MM-DD",
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
    "Right-click menu": "右鍵功能管理",
    "Reorder the items in the file and folder right-click menu, or turn off the ones you don't need (all on by default). The separator lines are listed too: move or remove them, or add your own": "調整檔案與文件夾右鍵選單中各功能的順序，或關閉不需要的功能（預設全部開啟）。分組分隔線會依順序自動產生",
    "Restore default order and switches": "還原預設順序與開關",
    "Batch rename presets": "批量重新命名方案",
    "Name pattern / numbering": "名稱格式 / 編號",
    "Delete this preset": "刪除此方案",
    "Keep at least one preset": "至少要保留一個方案",
    "{n} number, {name} original name, {ext} extension, {i} order": "{n} 序號、{name} 原名稱、{ext} 副檔名、{i} 順序",
    "One name per line, applied to the files in order": "每行一個名稱，依序套用到檔案",
    "Add preset": "新增方案",
    "New preset": "新方案",
    "No matching settings": "沒有符合的設定",
    "Open in a tab": "在分頁開啟",
    "Align left": "靠左",
    "Align center": "至中",
    "Align right": "靠右",
    "Default alignment": "預設對齊",
    "Custom shift distance…": "自訂移動距離…",
    "Shift distance (px)": "移動距離（px）",
    "Wrap text (wrap long names instead of showing …)": "自動換行（名稱過長時換行，而不是顯示 …）",
    "Auto-fit this column": "自動調整此欄寬度",
    "Auto-fit all columns": "自動調整所有欄寬",
    "Reset this column": "重設此欄格式",
    "Column format…": "欄位格式…",
    "Show files using this tag": "展開使用此標籤的文件",
    "Hide files using this tag": "收合使用此標籤的文件",
    "Sort this folder…": "排序此資料夾…",
    "{0} (including all subfolders)": "{0}（含所有子資料夾）",
    "Sorted \"{0}\"": "已排序「{0}」",
    "Folders at the top": "資料夾在最上方",
    "Folders at the bottom": "資料夾在最下方",
    "Mixed by name: folder before its file": "依名稱混合：資料夾排在同名前綴的文件之前",
    "Mixed by name: folder after its file": "依名稱混合：資料夾排在同名前綴的文件之後",
    "Folder position": "資料夾位置",
    "Where folders go when sorting. \"Mixed by name\" sorts files and folders together; a folder whose name starts with a file's name (for example A-image and A.md) goes right before or after that file.": "排序時資料夾的位置。「依名稱混合」會把文件與資料夾一起依名稱排序；名稱以某個文件名稱開頭的資料夾（例如 A-image 與 A.md）會緊接在該文件之前或之後。",
    "Copy names": "複製名稱",
    "Copied {0} names": "已複製 {0} 個名稱",
    "Not in any category": "未分類（排除已有文件夾分類）",
    "Copied": "已複製",
    "Separator": "分隔線",
    "Change icon": "更換圖示",
    "Reset icon": "重設圖示",
    "Insert a separator below": "在下方加入分隔線",
    "Remove separator": "移除分隔線",
    "Add separator": "新增分隔線",
    "Search settings… (type # to jump to a section)": "搜尋設定…（輸入 # 可跳到功能區塊）",
    "No matching sections": "沒有符合的功能區塊"
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
    "List replace": "名单替换",
    "Drag the ⋮⋮ handle or use ↑ ↓ to change the order (numbering follows this order)": "拖动左边的 ⋮⋮ 或按 ↑ ↓ 调整顺序（编号会依照这个顺序计算）",
    "Save as preset": "保存为方案",
    "Apply": "应用",
    "Batch rename ({0} items)": "批量重命名（{0} 个项目）",
    "Name pattern": "名称格式",
    "Available: {n} number, {name} original name (without extension), {ext} extension, {i} order (1,2,3…)": "可用：{n} 序号、{name} 原名称（不含扩展名）、{ext} 扩展名、{i} 顺序(1,2,3…)",
    "Start number": "起始数字",
    "Step": "递增",
    "Zero-padding digits": "补零位数",
    "0 means no padding": "0 代表不补零",
    "Name list": "名称列表",
    "One name per line, applied in order to the files below (extensions are kept). Paste directly or import a text file": "每行一个名称，依序应用到下面的文件（扩展名会保留）。可直接粘贴，或导入文字档",
    "Import list…": "导入名单…",
    "Find": "查找",
    "Replace with": "替换为",
    "Use regular expression": "使用正则表达式",
    "Case sensitive": "区分大小写",
    "Failed to read the file: ": "读取文件失败：",
    "Preset name": "方案名称",
    "Saved preset \"{0}\"": "已保存方案「{0}」",
    "Invalid name": "名称不合法",
    "Duplicate name": "名称重复",
    "An item with the same name already exists": "已存在同名项目",
    "\"{0}\" → \"{1}\": {2}": "「{0}」→「{1}」：{2}",
    "No items to rename": "没有要重命名的项目",
    "The list has {0} names but only {1} items: the extra {2} names will not be used (you can ignore this warning)": "名单有 {0} 个名称，但只有 {1} 个项目：多出的 {2} 个名称不会使用（可忽略此提示）",
    "The list has only {0} names but there are {1} items: the last {2} items keep their original names (you can ignore this warning)": "名单只有 {0} 个名称，但有 {1} 个项目：后面 {2} 个项目会维持原名（可忽略此提示）",
    "Drag to reorder": "拖动调整顺序",
    "Move up": "往上",
    "Move down": "往下",
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
    "Batch create": "批量创建",
    "Note": "笔记",
    "Folder": "文件夹",
    "Daily note (template)": "模板日记",
    "Daily note templates": "日记模板",
    "(Blank, no template)": "（空白，不使用模板）",
    "Count": "数量",
    "Up to {0} (adjustable in the plugin settings, maximum 50)": "最多 {0} 个（可在插件设置中调整，上限 50）",
    "Name prefix": "名称前缀",
    "After creating, batch rename opens automatically so you can give them the names you want": "创建后会自动进入批量重命名，可再改成想要的名称",
    "Untitled": "未命名",
    "Create and batch rename": "创建并批量重命名",
    "Please enter a valid count": "请输入有效的数量",
    "You can create at most {0} at a time": "最多只能创建 {0} 个",
    "Create failed: ": "创建失败：",
    "Created {0} items": "已创建 {0} 个项目",
    "Batch edit YAML ({0} files)": "批量修改 YAML（{0} 个文件）",
    "(Load a preset…)": "（加载方案…）",
    "There are no operations to save": "没有可保存的操作",
    "{0} operation(s) with per-file values cannot be saved in a preset and were skipped": "有 {0} 个「独立输入」的操作无法存入方案，已略过",
    "Delete preset": "删除方案",
    "Choose the preset to delete from the dropdown first": "请先在下拉菜单选择要删除的方案",
    "Add property": "新增属性",
    "Edit property": "编辑属性",
    "Delete property": "删除属性",
    "Sort properties": "排序属性",
    "Apply to": "应用范围",
    "All selected files ({0})": "全部选取的文件（{0}）",
    "Only some files…": "只应用到部分文件…",
    "Sort target": "排序对象",
    "Order of properties": "属性的顺序",
    "Values of list properties": "列表属性的值",
    "Sort order": "排序方式",
    "Ascending (A → Z)": "升序（A → Z）",
    "Descending (Z → A)": "降序（Z → A）",
    "Custom order": "自订顺序",
    "Custom property order": "自订属性顺序",
    "Drag the ⋮⋮ handle or use ↑ ↓ to reorder; properties higher in the list come first": "拖动左边的 ⋮⋮ 或按 ↑ ↓ 调整顺序；排在上面的属性会先出现",
    "Property name": "属性名称",
    "One property name per line; you can also write \"name=value\" to set the value directly": "每行一个属性名称；也可以写成「名称=值」直接指定值",
    "Leave empty = all list properties": "留空 = 全部列表属性",
    "Value type": "值的类型",
    "Auto-detect": "自动判断",
    "Text": "文字",
    "List (comma-separated)": "列表（以逗号分隔）",
    "Number": "数字",
    "Checkbox (true / false)": "复选框（true／false）",
    "Date": "日期",
    "Date and time": "日期与时间",
    "Value scope": "值应用范围",
    "Follow the apply scope (enter it once)": "跟随应用范围（只需输入一次）",
    "Enter each value separately (a different value per file)": "独立输入每个值（每个文件各自的值）",
    "Today": "今天",
    "Now": "现在",
    "Value": "值",
    "If the property already exists": "属性已存在时",
    "Skip": "略过",
    "Overwrite": "覆盖",
    "Merge into a list": "合并为列表",
    "New property name": "新属性名称",
    "Leave empty = keep the name": "留空 = 不改名",
    "Value handling": "值的处理",
    "Keep the value": "维持原值",
    "Set to a new value": "设为新值",
    "Find and replace": "查找并替换",
    "New value": "新值",
    "Delete only this value": "只删除这个值",
    "Leave empty = delete the whole property. For list properties, only matching items are removed": "留空 = 删除整个属性。属性是列表时，只移除符合的项目",
    "Convert (preview only, no files are changed)": "转换（先预览，不会修改文件）",
    "A blank line or box = that file is left alone. Fill in one value per line (in the file order below) or type or pick a value in each file's box": "留空的行或框 = 不处理该文件；可以每行填一个值（依下方文件顺序），也可以在每个文件的框里各别填写或选取",
    "Set all to today": "全部设为今天",
    "Set all to now": "全部设为现在",
    "One value per line": "每行一个值",
    "{0} files, matched in the order below": "共 {0} 个文件，依下方顺序对应",
    "(There are no properties to sort yet)": "（当前没有可排序的属性）",
    "Existing values (click to use)": "现有的值（点击使用）",
    "Existing properties (click to use)": "现有的属性（点击使用）",
    "Properties used elsewhere in the vault": "库中其他文件使用的属性",
    "Please choose at least one file": "请至少选择一个文件",
    "Please enter at least one value": "请至少填写一个值",
    "Please enter a property name first": "请先填写属性名称",
    "\"Enter each value separately\" works with a single property name only": "「独立输入每个值」只能搭配单一属性名称",
    "Only {0} files": "仅 {0} 个文件",
    "Add property {0} (a different value per file)": "新增属性 {0}（各文件各自的值）",
    "Add property {0} = {1}": "新增属性 {0} = {1}",
    "Rename {0} to {1}": "将 {0} 改名为 {1}",
    "Set the value of {0} separately per file": "依各文件分别设置 {0} 的值",
    "Set the value of {0} to {1}": "将 {0} 的值设为 {1}",
    "In the value of {0}, replace \"{1}\" with \"{2}\"": "在 {0} 的值中将「{1}」替换为「{2}」",
    "; ": "；",
    "Edit property {0}": "编辑属性 {0}",
    "Delete a different value from {0} per file": "依各文件分别删除 {0} 中的值",
    "Delete the value {1} from {0}": "删除 {0} 中的值 {1}",
    "Delete property {0}": "删除属性 {0}",
    "Sort the values of {0} ({1})": "排序 {0} 的值（{1}）",
    "Sort properties ({0})": "排序属性（{0}）",
    "Pending operations ({0})": "待应用的操作（{0}）",
    "No operations yet. Fill in the form above and press \"Convert\".": "尚未新增任何操作。填写上面的表单后按「转换」。",
    "Edit this operation": "编辑此操作",
    "Remove this operation": "移除此操作",
    "Preview": "预览",
    "Source": "原始码",
    "Show only changed files": "只显示有变更的文件",
    "Invalid YAML, skipped": "YAML 格式有误，已略过",
    "Changed": "有变更",
    "Unchanged": "无变更",
    "No matching files": "没有符合的文件",
    "(No properties)": "（没有属性）",
    "There are no operations to apply": "没有待应用的操作",
    "Updated {0} files, skipped {1}": "已更新 {0} 个文件，略过 {1} 个",
    "Updated {0} files": "已更新 {0} 个文件",
    "List": "列表",
    "Checkbox": "复选框",
    "Tags": "标签",
    "Aliases": "别名",
    "Tag name Z → A": "标签名称 Z → A",
    "Last used: newest first": "上次使用：最新使用",
    "Last used: oldest first": "上次使用：最旧使用",
    "Tag name A → Z": "标签名称 A → Z",
    "Sort: {0}": "排序：{0}",
    "Show nested tags": "显示巢状标签",
    "Collapse all": "全部折叠",
    "Expand all": "全部展开",
    "Search": "搜寻",
    "Search tags and their notes": "搜寻标签与注释",
    "Remove duplicate tags": "去除重复标签",
    "Find similar tags and merge or delete them": "找出相似的标签并合并或删除",
    "Search tags and their notes…": "搜寻标签与注释…",
    "No.": "编号",
    "Status": "状态",
    "Tag name": "标签名称",
    "Tag note": "标签注释",
    "Last used": "上次使用",
    "Locked (cannot be renamed, deleted or merged)": "已上锁（无法重命名、删除、合并）",
    "Click to lock": "点击上锁",
    "Click to edit the note": "点击编辑注释",
    "(No tags)": "（没有标签）",
    "Rename folder": "重命名文件夹",
    "Copied {0} tags": "已复制 {0} 个标签",
    "Copy failed": "复制失败",
    "Create tag": "创建标签",
    "Search (include)": "搜寻（包含）",
    "Search (exclude)": "搜寻（排除）",
    "Add search condition (include)": "加入搜寻条件（包含）",
    "Add search condition (exclude)": "加入搜寻条件（排除）",
    "Run search ({0} conditions)": "执行搜寻（{0} 个条件）",
    "Clear search conditions": "清除搜寻条件",
    "Search conditions cleared": "已清除搜寻条件",
    "Copy tag names": "复制标签名称",
    "Copy tag names with #": "复制加#的标签名称",
    "Rename": "重命名",
    "Exit selection mode": "取消选取状态",
    "Enter selection mode": "进入选取状态",
    "Select all": "全选",
    "Merge tags…": "合并标签…",
    "Delete tags…": "删除标签…",
    "Lock / unlock": "上锁／解锁",
    "Create folder": "创建文件夹",
    "Add to folder…": "加入文件夹…",
    "Move out of folder": "移出文件夹",
    "Delete folder (tags are kept)": "删除文件夹（标签保留）",
    "Move up one level": "移到上一层",
    "Move down one level": "移到下一层",
    "Merge tags ({0})": "合并标签（{0}）",
    "Tags to merge: {0}": "要合并的标签：{0}",
    "Resulting tag name": "合并后的标签名称",
    "Enter an existing tag name = merge into that tag; enter a new name = rename, then merge": "输入现有的标签名称＝合并到该标签；输入新的名称＝重命名后合并",
    "Merged tags in notes": "笔记中被合并的标签",
    "Replace with the new tag name": "替换成新的标签名称",
    "Delete everything": "全部删除",
    "Delete only the # (keep the text)": "只删除 #（保留文字）",
    "Merge": "合并",
    "Please enter the resulting tag name": "请输入合并后的标签名称",
    "Delete tags ({0})": "删除标签（{0}）",
    "This will affect {0} notes: {1}": "将影响 {0} 个笔记：{1}",
    "Tags in notes": "笔记中的标签",
    "Delete": "删除",
    "Finds tags with similar names. For each group, choose the tag to keep, then merge or delete the others.": "找出名称相似的标签。每组请选择要保留的标签，再选择合并或删除其余的标签。",
    "Similarity threshold (%)": "相似度阈值（%）",
    "A higher value lists only closer matches": "数值越高，只会列出越相近的标签",
    "No similar tags found": "没有找到相似的标签",
    "Merge (keep the selected one)": "合并（保留单选的那个）",
    "Delete (the checked tags)": "删除（勾选的标签）",
    "Property name Z → A": "属性名称 Z → A",
    "Property name A → Z": "属性名称 A → Z",
    "Search properties": "搜寻属性",
    "Search properties…": "搜寻属性…",
    "Property type": "属性类型",
    "Copied {0} properties": "已复制 {0} 个属性",
    "Rename value": "重命名值",
    "Delete value": "删除值",
    "Delete the value \"{1}\" from property {0} in all notes?": "确定从所有笔记的属性 {0} 中删除值「{1}」？",
    "Delete these {0} properties? They will be removed from all notes.": "确定删除这 {0} 个属性？所有笔记中的这些属性都会被移除。",
    "Copy property names": "复制属性名称",
    "Copy property type + name": "复制属性类型＋名称",
    "Copy properties (with values)": "复制属性（含值）",
    "Add values…": "添加值…",
    "Create property": "创建属性",
    "Delete folder (properties are kept)": "删除文件夹（属性保留）",
    "Rename properties ({0})": "重命名属性（{0}）",
    "Create": "创建",
    "Add values ({0} properties)": "添加值（{0} 个属性）",
    "These values are added to every note that uses these properties (values that already exist are not added twice)": "会把这些值加入所有已使用这些属性的笔记（已存在的值不会重复加入）",
    "Values to add": "要添加的值",
    "Append": "添加",
    "Move to": "移动到",
    "Enter or choose the destination folder path (created automatically if it does not exist; / means the vault root)": "输入或选择目标文件夹路径（不存在时会自动创建；/ 代表库根目录）",
    "Matching files ({0})": "符合条件的文件（{0}）",
    "Please enter the destination path first": "请先填写目标路径",
    "Moved {0} files, skipped {1}": "已移动 {0} 个文件，略过 {1} 个",
    "Moved {0} files": "已移动 {0} 个文件",
    "Move failed: ": "移动失败：",
    "Move files by tags ({0} files)": "根据标签移动文件（{0} 个文件）",
    "Click a tag to cycle: include (green) → exclude (red) → unused": "点击标签切换：包含（绿）→ 排除（红）→ 不使用",
    "(The selected files have no tags)": "（选取的文件没有标签）",
    "How included tags are matched": "包含标签的比对方式",
    "Must contain all selected tags": "必须包含所有选取的标签",
    "Contains any selected tag": "包含任一选取的标签",
    "Move": "移动",
    "Move files by YAML ({0} files)": "根据 YAML 移动文件（{0} 个文件）",
    "Add conditions to filter files (all conditions must match). Date and date + time properties can use a range.": "加入条件来筛选文件（所有条件需同时符合）。日期与日期＋时间类型的属性可以使用范围。",
    "+ Add condition": "＋ 新增条件",
    "Include": "包含",
    "Exclude": "排除",
    "Date range": "日期范围",
    "Specific values": "指定的值",
    "Has the property": "有此属性",
    "Remove condition": "移除条件",
    "From": "从",
    "To": "到",
    "Back": "上一页",
    "Forward": "下一页",
    "Up one level": "上一层",
    "\"Cross-level move\" is off; cannot move to another level": "「跨层级移动」已关闭，无法移到其他层级",
    "Path copied": "已复制路径",
    "Copy path": "复制路径",
    "Copy full path": "复制完整路径",
    "Selection mode ({0} selected)": "选取模式（已选 {0}）",
    "Done": "结束选取",
    "Temp · {0}": "临时 · {0}",
    "Pin to top": "置顶",
    "Bookmarked": "已加入书签",
    "{0} files": "{0} 个文件",
    "{0} folders": "{0} 个文件夹",
    "Open": "打开",
    "Rename temporary folder": "重命名临时文件夹",
    "Create temporary folder": "创建临时文件夹",
    "Delete temporary folder (shortcuts move back to top level)": "删除临时文件夹（快捷方式移回顶层）",
    "New focus zone": "新增专注区",
    "Rename this focus zone": "重命名此专注区",
    "Delete this focus zone": "删除此专注区",
    "Select all (including collapsed)": "全选（含未展开）",
    "New note": "新增笔记",
    "New folder": "新增文件夹",
    "New {0}": "新增 {0}",
    "Create daily note from template": "创建模板日记",
    "Batch create…": "批量创建…",
    "Paste to root": "粘贴到根目录",
    "Paste to current folder": "粘贴到当前文件夹",
    "Select all (visible)": "全选（可见项目）",
    "Tag manager": "标签管理",
    "Property manager": "属性管理",
    "Focus File Manager": "专注文件管理器",
    "(This folder is empty)": "（此文件夹是空的）",
    "(The vault is empty)": "（库是空的）",
    "Select files/folders on the left, then right-click \"Add to focus zone\"": "在左侧选取文件／文件夹，右键「加入专注区」",
    "Right-click here to create a focus zone": "在此处按右键，新增一个专注区",
    "Reset manual order…": "重置手动排序…",
    "Reset the manual order? All manual ordering records will be cleared.": "确定要重置手动排序吗？所有手动排序纪录将被清除。",
    "Refresh": "刷新",
    "Refresh (manually refresh open-file markers)": "刷新（手动刷新打开标记）",
    "Plugin settings": "插件设置",
    "Open plugin settings": "打开插件设置",
    "Show: {0}": "显示：{0}",
    "Click to switch: File manager → Focus zone → Both (current: {0})": "点击切换：文件管理 → 专注区 → 两者（当前：{0}）",
    "On": "开",
    "Off": "关",
    "Cross-level move: {0}": "跨层级移动：{0}",
    "Cross-level move (limits dragging): {0}": "跨层级移动（限制拖动）：{0}",
    "Default": "默认",
    "Manual": "手动",
    "Sort order: {0}": "排序方式：{0}",
    "Shown": "显示",
    "Hidden": "隐藏",
    "Excluded files: {0}": "排除的文件：{0}",
    "Click to show or hide excluded files and folders": "点击切换显示或隐藏被排除的文件与文件夹",
    "Collapse all (press again to switch to expand all)": "全部折叠（再按一次切换为全部展开）",
    "Expand all (press again to switch to collapse all)": "全部展开（再按一次切换为全部折叠）",
    "+": "＋",
    "Open Focus File Manager in sidebar": "在侧边栏打开专注文件管理器",
    "Open Focus File Manager in main area": "在主区域打开专注文件管理器",
    "Show file manager only": "只显示文件管理",
    "Show focus zone only": "只显示专注区",
    "Show both": "两者同时显示",
    "Cycle view (File manager → Focus zone → Both)": "切换显示（文件管理 → 专注区 → 两者）",
    "Open tag manager in a tab": "在标签页打开标签管理",
    "Open property manager in a tab": "在标签页打开属性管理",
    "Show tag manager in the left area": "在左侧区域显示标签管理",
    "Show property manager in the left area": "在左侧区域显示属性管理",
    "Show file manager in the left area": "在左侧区域显示文件管理",
    "Locate in Focus File Manager": "在专注文件管理器中定位",
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
    "\"{0}\" is already at the top level": "「{0}」已在最上层",
    "No folder above \"{0}\" to move it into": "「{0}」上方没有可放入的文件夹",
    "The name contains invalid characters": "名称含有不合法字元",
    "Delete {0} items? (moved to trash per Obsidian settings)": "确定删除 {0} 个项目？（依 Obsidian 设置移到回收站）",
    "Delete failed: ": "删除失败：",
    "Canvas": "画布",
    "Excalidraw plugin not found; make sure it is enabled": "找不到 Excalidraw 插件，请确认已启用",
    "Failed to create Excalidraw: ": "创建 Excalidraw 失败：",
    "This file is excluded (hidden); show excluded files first": "此文件已被排除（隐藏），请先显示被排除的文件",
    "Open this plugin's settings under \"Settings → Community plugins\"": "请到「设置 → 第三方插件」打开本插件的设置",
    "Today's note already exists: {0}": "今日日记已存在：{0}",
    "Daily note created: {0}": "已创建日记：{0}",
    "Blank daily note (no template)": "空白日记（不使用模板）",
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
    "This item is hidden by the exclusion rule \"{0}\"; change it in the settings": "此项目由排除规则「{0}」隐藏，请到设置中修改",
    "Open in new tab": "在新标签页打开",
    "Open to the right": "在右侧打开",
    "Open in new window": "在新窗口打开",
    "Show in folder": "在文件夹中显示",
    "Selection mode (enter / exit)": "选取状态（进入／取消）",
    "Add to focus zone…": "加入专注区…",
    "Remove from focus zone": "从专注区移除",
    "Remove from focus zone ({0})": "从专注区移除（{0}）",
    "Move to temporary folder…": "移到临时文件夹…",
    "Move out of temporary folder": "移出临时文件夹",
    "Copy": "复制",
    "Cut": "剪切",
    "Paste": "粘贴",
    "Add / remove bookmark": "加入／移除书签",
    "Remove bookmark": "移除书签",
    "Add bookmark": "加入书签",
    "Batch rename…": "批量重命名…",
    "Batch rename… ({0})": "批量重命名…（{0}）",
    "Batch rename files inside folder…": "批量重命名文件夹内的文件…",
    "This folder has no files": "此文件夹内没有文件",
    "Batch edit YAML…": "批量修改 YAML…",
    "Move files by tags…": "根据标签移动文件…",
    "Move files by YAML…": "根据 YAML 移动文件…",
    "Appearance (icon / color)…": "外观（图标／颜色）…",
    "Unpin": "取消置顶",
    "Move down one level (into the previous folder)": "移到下一层（放入上一个文件夹）",
    "Hide / unhide (exclude)": "隐藏／取消隐藏（排除）",
    "Unhide (remove exclusion)": "取消隐藏（移出排除）",
    "Hide (add exclusion)": "隐藏（加入排除）",
    "New note here": "在此新增笔记",
    "New folder here": "在此新增文件夹",
    "New other file types here (Base, Canvas…)": "在此新增其他文件类型（Base、画布…）",
    "New {0} here": "在此新增 {0}",
    "Properties…": "属性…",
    "Tag #{0} is locked and cannot be renamed, deleted or merged": "标签 #{0} 已上锁，无法重命名、删除或合并",
    "Invalid tag name (it cannot contain spaces or #)": "标签名称不合法（不可包含空白或 #）",
    "The core Search plugin is not available": "找不到可用的核心插件「搜寻」",
    "Search condition added ({0} in total)": "已加入搜寻条件（共 {0} 个）",
    "There is no folder above to move it into": "上方没有可放入的文件夹",
    "This version of Obsidian does not support setting property types from a plugin": "此版本的 Obsidian 不支援从插件设置属性类型",
    "Set the type of {0} properties": "已设置 {0} 个属性的类型",
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
    "Search settings…": "搜寻设置…",
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
    "When enabled, a single click only selects; open files with the open icons below (or the right-click menu)": "启用后，单击只会选取；请搭配下方的打开符号（或右键菜单）来打开文件",
    "How files open": "打开文件的方式",
    "Applies to single-click open, the right-click \"Open\" and the open icon": "应用于单击打开、右键「打开」与打开符号",
    "Open in current tab": "在当前标签页打开",
    "Show open icon": "显示打开符号",
    "Show an \"Open\" icon beside each file (on by default)": "在每个文件旁显示「打开」符号（默认打开）",
    "Show \"open in new tab to the right\" icon": "显示「在右侧新标签页打开」符号",
    "Show an \"open in new tab to the right\" icon beside each file (on by default). If \"How files open\" is set to new tab, only one icon is shown": "在每个文件旁显示「在右侧新标签页打开」符号（默认打开）。若「打开文件的方式」为新标签页，则只显示一个符号",
    "Open icons follow the sidebar": "打开符号跟随侧边栏移动",
    "The icons stay pinned to the right edge of the visible area, so long file names never push them out of the sidebar (on by default)": "打开符号会固定在可见范围的右侧，不会被过长的文件名挤出侧边栏之外（默认打开）",
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
    "Highlight new items": "新增项目后高亮",
    "After creating a note, folder, etc. from the menu, the new item's background is briefly highlighted (on by default)": "右键新增笔记、文件夹等之后，新项目的背景会短暂高亮（默认打开）",
    "Highlight color": "高亮颜色",
    "Leave empty to use the theme's accent color. Accepts color names, RGB or HEX": "留空 = 使用主题的强调色。可填颜色名称、RGB、HEX",
    "Follow theme": "跟随主题",
    "Reset (follow theme)": "重置（跟随主题）",
    "Locate new items": "新增项目后定位到该项目",
    "Automatically expands parent folders and scrolls to the new item (on by default)": "自动展开上层文件夹并滚动到新项目的位置（默认打开）",
    "Open in the left sidebar when the plugin is enabled": "启用插件时自动在左侧栏打开",
    "When you enable this plugin manually inside Obsidian, Focus File Manager opens in the left sidebar automatically (on by default)": "在 Obsidian 里手动启用本插件时，会自动在左侧边栏打开专注文件管理器（默认打开）",
    "Maximum for batch create": "批量创建的最大数量",
    "The most items one batch create can make. Default 10, maximum 50": "单次批量创建文件的上限。默认 10，最高 50",
    "Show excluded files": "显示被排除的文件",
    "Hidden by default. You can also toggle it with the eye button on the toolbar": "默认隐藏。也可以用工具列的眼睛按钮切换",
    "Exclusion list (hidden files / folders)": "排除列表（隐藏的文件／文件夹）",
    "One per line. Starting with / or containing / means a path (e.g. /Projects/Archive); otherwise it is a name (any item with that name). Wildcards * and ? work. \"Hide\" in the right-click menu writes here automatically": "每行一个。以 / 开头或含有 / 的是路径（例如 /Projects/Archive），否则是名称（任何位置的同名项目）。可用 * 与 ?。右键菜单的「隐藏」会自动写入这里",
    "Tags in notes: single click edits, double click searches": "笔记中的标签：单击直接编辑，双击才搜寻",
    "When on (default), a single click on a tag (#tag) in a note does not jump to Obsidian's search so you can edit it directly; a double click searches for the tag": "启用后（默认打开），单击笔记中的标签（#标签）不会跳转到 Obsidian 的搜寻，可以直接编辑；双击才会搜寻该标签",
    "Locate the file when clicking the file name under the tab bar": "点击标签页栏下方的文件名时定位该文件",
    "A single click on the file name locates and highlights the file in this plugin; a double click starts renaming (on by default)": "单击文件名会在本插件中定位并高亮该文件；双击则进入重命名（默认打开）",
    "Prefer this plugin when clicking the path under the tab bar": "点击标签页栏下方的路径时优先使用本插件",
    "When you click a folder name in the path above a note's title, this plugin locates and shows that folder (on by default)": "点击笔记标题上方的路径（文件夹名称）时，改由本插件定位并显示该文件夹（默认打开）",
    "Daily note template paths": "日记模板路径",
    "One path per line; each can be a template file or a folder (every .md inside a folder is listed as a template). Supports {{date}}, {{date:FORMAT}}, {{time}} and {{title}}": "每行一个路径，可以是模板文件或文件夹（文件夹内所有 .md 都会列为模板）。支援 {{date}}、{{date:格式}}、{{time}}、{{title}}",
    "Daily note file name format": "日记文件名格式",
    "Uses moment.js format tokens; default YYYY-MM-DD": "使用 moment 格式，默认 YYYY-MM-DD",
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
    "Right-click menu": "右键功能管理",
    "Reorder the items in the file and folder right-click menu, or turn off the ones you don't need (all on by default). The separator lines are listed too: move or remove them, or add your own": "调整文件与文件夹右键菜单中各功能的顺序，或关闭不需要的功能（默认全部打开）。分组分隔线会依顺序自动产生",
    "Restore default order and switches": "还原默认顺序与开关",
    "Batch rename presets": "批量重命名方案",
    "Name pattern / numbering": "名称格式 / 编号",
    "Delete this preset": "删除此方案",
    "Keep at least one preset": "至少要保留一个方案",
    "{n} number, {name} original name, {ext} extension, {i} order": "{n} 序号、{name} 原名称、{ext} 扩展名、{i} 顺序",
    "One name per line, applied to the files in order": "每行一个名称，依序应用到文件",
    "Add preset": "新增方案",
    "New preset": "新方案",
    "No matching settings": "没有符合的设置",
    "編號（100、200…）": "编号（100、200…）",
    "替換字符": "替换字符",
    "Open in a tab": "在标签页打开",
    "Align left": "靠左",
    "Align center": "居中",
    "Align right": "靠右",
    "Default alignment": "默认对齐",
    "Custom shift distance…": "自定义移动距离…",
    "Shift distance (px)": "移动距离（px）",
    "Wrap text (wrap long names instead of showing …)": "自动换行（名称过长时换行，而不是显示 …）",
    "Auto-fit this column": "自动调整此列宽度",
    "Auto-fit all columns": "自动调整所有列宽",
    "Reset this column": "重置此列格式",
    "Column format…": "列格式…",
    "Show files using this tag": "展开使用此标签的文件",
    "Hide files using this tag": "收起使用此标签的文件",
    "Sort this folder…": "排序此文件夹…",
    "{0} (including all subfolders)": "{0}（含所有子文件夹）",
    "Sorted \"{0}\"": "已排序「{0}」",
    "Folders at the top": "文件夹在最上方",
    "Folders at the bottom": "文件夹在最下方",
    "Mixed by name: folder before its file": "按名称混合：文件夹排在同名前缀的文件之前",
    "Mixed by name: folder after its file": "按名称混合：文件夹排在同名前缀的文件之后",
    "Folder position": "文件夹位置",
    "Where folders go when sorting. \"Mixed by name\" sorts files and folders together; a folder whose name starts with a file's name (for example A-image and A.md) goes right before or after that file.": "排序时文件夹的位置。「按名称混合」会把文件和文件夹一起按名称排序；名称以某个文件名称开头的文件夹（例如 A-image 和 A.md）会紧挨在该文件之前或之后。",
    "Copy names": "复制名称",
    "Copied {0} names": "已复制 {0} 个名称",
    "Not in any category": "未分类（排除已有文件夹分类）",
    "Copied": "已复制",
    "Separator": "分隔线",
    "Change icon": "更换图标",
    "Reset icon": "重置图标",
    "Insert a separator below": "在下方添加分隔线",
    "Remove separator": "移除分隔线",
    "Add separator": "添加分隔线",
    "Search settings… (type # to jump to a section)": "搜索设置…（输入 # 可跳转到功能区块）",
    "No matching sections": "没有符合的功能区块"
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
    "List replace": "リストで置換",
    "Drag the ⋮⋮ handle or use ↑ ↓ to change the order (numbering follows this order)": "左側の ⋮⋮ をドラッグするか ↑ ↓ で順序を変更します（連番はこの順序で付けられます）",
    "Save as preset": "プリセットとして保存",
    "Apply": "適用",
    "Batch rename ({0} items)": "一括名前変更（{0} 件）",
    "Name pattern": "名前パターン",
    "Available: {n} number, {name} original name (without extension), {ext} extension, {i} order (1,2,3…)": "使用可能：{n} 連番、{name} 元の名前（拡張子なし）、{ext} 拡張子、{i} 順番（1,2,3…）",
    "Start number": "開始番号",
    "Step": "増分",
    "Zero-padding digits": "ゼロ埋めの桁数",
    "0 means no padding": "0 はゼロ埋めなし",
    "Name list": "名前リスト",
    "One name per line, applied in order to the files below (extensions are kept). Paste directly or import a text file": "1行に1つの名前を、下のファイルへ順に適用します（拡張子は保持されます）。直接貼り付けるか、テキストファイルをインポートできます",
    "Import list…": "リストをインポート…",
    "Find": "検索",
    "Replace with": "置換後",
    "Use regular expression": "正規表現を使う",
    "Case sensitive": "大文字小文字を区別",
    "Failed to read the file: ": "ファイルの読み込みに失敗：",
    "Preset name": "プリセット名",
    "Saved preset \"{0}\"": "プリセット「{0}」を保存しました",
    "Invalid name": "無効な名前",
    "Duplicate name": "名前が重複",
    "An item with the same name already exists": "同名の項目が既に存在します",
    "\"{0}\" → \"{1}\": {2}": "「{0}」→「{1}」：{2}",
    "No items to rename": "名前を変更する項目がありません",
    "The list has {0} names but only {1} items: the extra {2} names will not be used (you can ignore this warning)": "リストには {0} 個の名前がありますが、項目は {1} 個だけです。余った {2} 個の名前は使用されません（この警告は無視できます）",
    "The list has only {0} names but there are {1} items: the last {2} items keep their original names (you can ignore this warning)": "リストには {0} 個の名前しかありませんが、項目は {1} 個あります。最後の {2} 個は元の名前のままになります（この警告は無視できます）",
    "Drag to reorder": "ドラッグで順序を変更",
    "Move up": "上へ",
    "Move down": "下へ",
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
    "Batch create": "一括作成",
    "Note": "ノート",
    "Folder": "フォルダ",
    "Daily note (template)": "デイリーノート（テンプレート）",
    "Daily note templates": "デイリーノートのテンプレート",
    "(Blank, no template)": "（空白、テンプレートなし）",
    "Count": "数量",
    "Up to {0} (adjustable in the plugin settings, maximum 50)": "最大 {0} 個（プラグイン設定で変更可能、上限 50）",
    "Name prefix": "名前のプレフィックス",
    "After creating, batch rename opens automatically so you can give them the names you want": "作成後は自動的に一括名前変更が開き、好きな名前に変更できます",
    "Untitled": "無題",
    "Create and batch rename": "作成して一括名前変更",
    "Please enter a valid count": "有効な数量を入力してください",
    "You can create at most {0} at a time": "一度に作成できるのは最大 {0} 個です",
    "Create failed: ": "作成に失敗：",
    "Created {0} items": "{0} 件を作成しました",
    "Batch edit YAML ({0} files)": "YAML を一括編集（{0} ファイル）",
    "(Load a preset…)": "（プリセットを読み込み…）",
    "There are no operations to save": "保存できる操作がありません",
    "{0} operation(s) with per-file values cannot be saved in a preset and were skipped": "ファイルごとに値を入力する操作が {0} 件あり、プリセットには保存できないためスキップしました",
    "Delete preset": "プリセットを削除",
    "Choose the preset to delete from the dropdown first": "先にドロップダウンから削除するプリセットを選んでください",
    "Add property": "プロパティを追加",
    "Edit property": "プロパティを編集",
    "Delete property": "プロパティを削除",
    "Sort properties": "プロパティを並べ替え",
    "Apply to": "適用範囲",
    "All selected files ({0})": "選択したすべてのファイル（{0}）",
    "Only some files…": "一部のファイルのみ…",
    "Sort target": "並べ替えの対象",
    "Order of properties": "プロパティの順序",
    "Values of list properties": "リストプロパティの値",
    "Sort order": "並べ替え方法",
    "Ascending (A → Z)": "昇順（A → Z）",
    "Descending (Z → A)": "降順（Z → A）",
    "Custom order": "カスタム順",
    "Custom property order": "プロパティのカスタム順",
    "Drag the ⋮⋮ handle or use ↑ ↓ to reorder; properties higher in the list come first": "左側の ⋮⋮ をドラッグするか ↑ ↓ で順序を変更します。上にあるプロパティが先に並びます",
    "Property name": "プロパティ名",
    "One property name per line; you can also write \"name=value\" to set the value directly": "1行に1つのプロパティ名。「名前=値」と書いて値を直接指定することもできます",
    "Leave empty = all list properties": "空欄 = すべてのリストプロパティ",
    "Value type": "値の種類",
    "Auto-detect": "自動判定",
    "Text": "テキスト",
    "List (comma-separated)": "リスト（カンマ区切り）",
    "Number": "数値",
    "Checkbox (true / false)": "チェックボックス（true／false）",
    "Date": "日付",
    "Date and time": "日付と時刻",
    "Value scope": "値の適用範囲",
    "Follow the apply scope (enter it once)": "適用範囲に従う（1回の入力で全体に適用）",
    "Enter each value separately (a different value per file)": "値を個別に入力（ファイルごとに別の値）",
    "Today": "今日",
    "Now": "現在",
    "Value": "値",
    "If the property already exists": "プロパティが既に存在する場合",
    "Skip": "スキップ",
    "Overwrite": "上書き",
    "Merge into a list": "リストに統合",
    "New property name": "新しいプロパティ名",
    "Leave empty = keep the name": "空欄 = 名前を変更しない",
    "Value handling": "値の扱い",
    "Keep the value": "値を維持",
    "Set to a new value": "新しい値に設定",
    "Find and replace": "検索して置換",
    "New value": "新しい値",
    "Delete only this value": "この値のみ削除",
    "Leave empty = delete the whole property. For list properties, only matching items are removed": "空欄 = プロパティ全体を削除。リストの場合は一致する項目のみ削除します",
    "Convert (preview only, no files are changed)": "変換（プレビューのみ。ファイルは変更されません）",
    "A blank line or box = that file is left alone. Fill in one value per line (in the file order below) or type or pick a value in each file's box": "空の行や欄 = そのファイルは処理しません。1行に1つの値を（下のファイル順で）入力するか、各ファイルの欄に個別に入力・選択できます",
    "Set all to today": "すべて今日に設定",
    "Set all to now": "すべて現在に設定",
    "One value per line": "1行に1つの値",
    "{0} files, matched in the order below": "{0} ファイル。下の順序で対応します",
    "(There are no properties to sort yet)": "（並べ替えるプロパティがありません）",
    "Existing values (click to use)": "既存の値（クリックで使用）",
    "Existing properties (click to use)": "既存のプロパティ（クリックで使用）",
    "Properties used elsewhere in the vault": "保管庫内の他のファイルで使われているプロパティ",
    "Please choose at least one file": "ファイルを1つ以上選択してください",
    "Please enter at least one value": "値を1つ以上入力してください",
    "Please enter a property name first": "先にプロパティ名を入力してください",
    "\"Enter each value separately\" works with a single property name only": "「値を個別に入力」は単一のプロパティ名でのみ使用できます",
    "Only {0} files": "{0} ファイルのみ",
    "Add property {0} (a different value per file)": "プロパティ {0} を追加（ファイルごとに別の値）",
    "Add property {0} = {1}": "プロパティ {0} = {1} を追加",
    "Rename {0} to {1}": "{0} を {1} に名前変更",
    "Set the value of {0} separately per file": "{0} の値をファイルごとに個別に設定",
    "Set the value of {0} to {1}": "{0} の値を {1} に設定",
    "In the value of {0}, replace \"{1}\" with \"{2}\"": "{0} の値内の「{1}」を「{2}」に置換",
    "; ": "；",
    "Edit property {0}": "プロパティ {0} を編集",
    "Delete a different value from {0} per file": "{0} から削除する値をファイルごとに個別に指定",
    "Delete the value {1} from {0}": "{0} から値 {1} を削除",
    "Delete property {0}": "プロパティ {0} を削除",
    "Sort the values of {0} ({1})": "{0} の値を並べ替え（{1}）",
    "Sort properties ({0})": "プロパティを並べ替え（{0}）",
    "Pending operations ({0})": "適用待ちの操作（{0}）",
    "No operations yet. Fill in the form above and press \"Convert\".": "まだ操作がありません。上のフォームに入力して「変換」を押してください。",
    "Edit this operation": "この操作を編集",
    "Remove this operation": "この操作を削除",
    "Preview": "プレビュー",
    "Source": "ソース",
    "Show only changed files": "変更のあるファイルのみ表示",
    "Invalid YAML, skipped": "YAML の形式が不正なためスキップしました",
    "Changed": "変更あり",
    "Unchanged": "変更なし",
    "No matching files": "該当するファイルはありません",
    "(No properties)": "（プロパティなし）",
    "There are no operations to apply": "適用する操作がありません",
    "Updated {0} files, skipped {1}": "{0} ファイルを更新、{1} 件をスキップしました",
    "Updated {0} files": "{0} ファイルを更新しました",
    "List": "リスト",
    "Checkbox": "チェックボックス",
    "Tags": "タグ",
    "Aliases": "エイリアス",
    "Tag name Z → A": "タグ名 Z → A",
    "Last used: newest first": "最終使用：新しい順",
    "Last used: oldest first": "最終使用：古い順",
    "Tag name A → Z": "タグ名 A → Z",
    "Sort: {0}": "並べ替え：{0}",
    "Show nested tags": "ネストしたタグを表示",
    "Collapse all": "すべて折りたたむ",
    "Expand all": "すべて展開",
    "Search": "検索",
    "Search tags and their notes": "タグとメモを検索",
    "Remove duplicate tags": "重複タグを整理",
    "Find similar tags and merge or delete them": "似たタグを見つけて統合または削除",
    "Search tags and their notes…": "タグとメモを検索…",
    "No.": "番号",
    "Status": "状態",
    "Tag name": "タグ名",
    "Tag note": "タグのメモ",
    "Last used": "最終使用",
    "Locked (cannot be renamed, deleted or merged)": "ロック中（名前変更・削除・統合はできません）",
    "Click to lock": "クリックでロック",
    "Click to edit the note": "クリックでメモを編集",
    "(No tags)": "（タグがありません）",
    "Rename folder": "フォルダの名前を変更",
    "Copied {0} tags": "{0} 個のタグをコピーしました",
    "Copy failed": "コピーに失敗しました",
    "Create tag": "タグを作成",
    "Search (include)": "検索（含む）",
    "Search (exclude)": "検索（除外）",
    "Add search condition (include)": "検索条件に追加（含む）",
    "Add search condition (exclude)": "検索条件に追加（除外）",
    "Run search ({0} conditions)": "検索を実行（{0} 件の条件）",
    "Clear search conditions": "検索条件をクリア",
    "Search conditions cleared": "検索条件をクリアしました",
    "Copy tag names": "タグ名をコピー",
    "Copy tag names with #": "# 付きのタグ名をコピー",
    "Rename": "名前を変更",
    "Exit selection mode": "選択モードを終了",
    "Enter selection mode": "選択モードに入る",
    "Select all": "すべて選択",
    "Merge tags…": "タグを統合…",
    "Delete tags…": "タグを削除…",
    "Lock / unlock": "ロック／ロック解除",
    "Create folder": "フォルダを作成",
    "Add to folder…": "フォルダに追加…",
    "Move out of folder": "フォルダから出す",
    "Delete folder (tags are kept)": "フォルダを削除（タグは残ります）",
    "Move up one level": "1つ上の階層へ移動",
    "Move down one level": "1つ下の階層へ",
    "Merge tags ({0})": "タグを統合（{0}）",
    "Tags to merge: {0}": "統合するタグ：{0}",
    "Resulting tag name": "統合後のタグ名",
    "Enter an existing tag name = merge into that tag; enter a new name = rename, then merge": "既存のタグ名を入力 = そのタグへ統合。新しい名前を入力 = 名前を変更して統合",
    "Merged tags in notes": "ノート内の統合されるタグ",
    "Replace with the new tag name": "新しいタグ名に置換",
    "Delete everything": "すべて削除",
    "Delete only the # (keep the text)": "# のみ削除（文字は残す）",
    "Merge": "統合",
    "Please enter the resulting tag name": "統合後のタグ名を入力してください",
    "Delete tags ({0})": "タグを削除（{0}）",
    "This will affect {0} notes: {1}": "{0} 件のノートに影響します：{1}",
    "Tags in notes": "ノート内のタグ",
    "Delete": "削除",
    "Finds tags with similar names. For each group, choose the tag to keep, then merge or delete the others.": "名前が似ているタグを見つけます。グループごとに残すタグを選び、残りを統合または削除してください。",
    "Similarity threshold (%)": "類似度のしきい値（%）",
    "A higher value lists only closer matches": "値が大きいほど、より近いタグだけが表示されます",
    "No similar tags found": "似たタグは見つかりませんでした",
    "Merge (keep the selected one)": "統合（選択したものを残す）",
    "Delete (the checked tags)": "削除（チェックしたタグ）",
    "Property name Z → A": "プロパティ名 Z → A",
    "Property name A → Z": "プロパティ名 A → Z",
    "Search properties": "プロパティを検索",
    "Search properties…": "プロパティを検索…",
    "Property type": "プロパティの種類",
    "Copied {0} properties": "{0} 個のプロパティをコピーしました",
    "Rename value": "値の名前を変更",
    "Delete value": "値を削除",
    "Delete the value \"{1}\" from property {0} in all notes?": "すべてのノートのプロパティ {0} から値「{1}」を削除しますか？",
    "Delete these {0} properties? They will be removed from all notes.": "これら {0} 個のプロパティを削除しますか？すべてのノートから削除されます。",
    "Copy property names": "プロパティ名をコピー",
    "Copy property type + name": "プロパティの種類＋名前をコピー",
    "Copy properties (with values)": "プロパティ（値つき）をコピー",
    "Add values…": "値を追加…",
    "Create property": "プロパティを作成",
    "Delete folder (properties are kept)": "フォルダを削除（プロパティは残ります）",
    "Rename properties ({0})": "プロパティの名前を変更（{0}）",
    "Create": "作成",
    "Add values ({0} properties)": "値を追加（{0} 個のプロパティ）",
    "These values are added to every note that uses these properties (values that already exist are not added twice)": "これらの値を、そのプロパティを使っているすべてのノートに追加します（既にある値は重複して追加されません）",
    "Values to add": "追加する値",
    "Append": "追記",
    "Move to": "移動先",
    "Enter or choose the destination folder path (created automatically if it does not exist; / means the vault root)": "移動先フォルダのパスを入力または選択（存在しない場合は自動作成。/ は保管庫のルート）",
    "Matching files ({0})": "条件に一致するファイル（{0}）",
    "Please enter the destination path first": "先に移動先のパスを入力してください",
    "Moved {0} files, skipped {1}": "{0} ファイルを移動、{1} 件をスキップしました",
    "Moved {0} files": "{0} ファイルを移動しました",
    "Move failed: ": "移動に失敗：",
    "Move files by tags ({0} files)": "タグでファイルを移動（{0} ファイル）",
    "Click a tag to cycle: include (green) → exclude (red) → unused": "タグをクリックして切り替え：含む（緑）→ 除外（赤）→ 使用しない",
    "(The selected files have no tags)": "（選択したファイルにはタグがありません）",
    "How included tags are matched": "含めるタグの照合方法",
    "Must contain all selected tags": "選択したすべてのタグを含む",
    "Contains any selected tag": "選択したタグのいずれかを含む",
    "Move": "移動",
    "Move files by YAML ({0} files)": "YAML でファイルを移動（{0} ファイル）",
    "Add conditions to filter files (all conditions must match). Date and date + time properties can use a range.": "条件を追加してファイルを絞り込みます（すべての条件に一致する必要があります）。日付と日付＋時刻のプロパティは範囲を指定できます。",
    "+ Add condition": "＋ 条件を追加",
    "Include": "含む",
    "Exclude": "除外",
    "Date range": "日付の範囲",
    "Specific values": "指定した値",
    "Has the property": "プロパティがある",
    "Remove condition": "条件を削除",
    "From": "開始",
    "To": "終了",
    "Back": "戻る",
    "Forward": "進む",
    "Up one level": "1つ上の階層へ",
    "\"Cross-level move\" is off; cannot move to another level": "「階層をまたぐ移動」がオフのため、他の階層へ移動できません",
    "Path copied": "パスをコピーしました",
    "Copy path": "パスをコピー",
    "Copy full path": "フルパスをコピー",
    "Selection mode ({0} selected)": "選択モード（{0} 件選択）",
    "Done": "選択を終了",
    "Temp · {0}": "一時 · {0}",
    "Pin to top": "先頭にピン留め",
    "Bookmarked": "ブックマーク済み",
    "{0} files": "{0} ファイル",
    "{0} folders": "{0} フォルダ",
    "Open": "開く",
    "Rename temporary folder": "一時フォルダの名前を変更",
    "Create temporary folder": "一時フォルダを作成",
    "Delete temporary folder (shortcuts move back to top level)": "一時フォルダを削除（ショートカットは最上位に戻ります）",
    "New focus zone": "新しいフォーカスゾーン",
    "Rename this focus zone": "このフォーカスゾーンの名前を変更",
    "Delete this focus zone": "このフォーカスゾーンを削除",
    "Select all (including collapsed)": "すべて選択（折りたたみ内も含む）",
    "New note": "新規ノート",
    "New folder": "新規フォルダ",
    "New {0}": "新規 {0}",
    "Create daily note from template": "テンプレートからデイリーノートを作成",
    "Batch create…": "一括作成…",
    "Paste to root": "ルートに貼り付け",
    "Paste to current folder": "現在のフォルダに貼り付け",
    "Select all (visible)": "すべて選択（表示中）",
    "Tag manager": "タグ管理",
    "Property manager": "プロパティ管理",
    "Focus File Manager": "Focus File Manager",
    "(This folder is empty)": "（このフォルダは空です）",
    "(The vault is empty)": "（保管庫は空です）",
    "Select files/folders on the left, then right-click \"Add to focus zone\"": "左側でファイル／フォルダを選択し、右クリックで「フォーカスゾーンに追加」",
    "Right-click here to create a focus zone": "ここを右クリックしてフォーカスゾーンを作成",
    "Reset manual order…": "手動並べ替えをリセット…",
    "Reset the manual order? All manual ordering records will be cleared.": "手動並べ替えをリセットしますか？すべての手動並べ替えの記録が消去されます。",
    "Refresh": "更新",
    "Refresh (manually refresh open-file markers)": "更新（開いているファイルのマークを手動で更新）",
    "Plugin settings": "プラグイン設定",
    "Open plugin settings": "プラグイン設定を開く",
    "Show: {0}": "表示：{0}",
    "Click to switch: File manager → Focus zone → Both (current: {0})": "クリックで切り替え：ファイル管理 → フォーカスゾーン → 両方（現在：{0}）",
    "On": "オン",
    "Off": "オフ",
    "Cross-level move: {0}": "階層をまたぐ移動：{0}",
    "Cross-level move (limits dragging): {0}": "階層をまたぐ移動（ドラッグを制限）：{0}",
    "Default": "デフォルト",
    "Manual": "手動",
    "Sort order: {0}": "並べ替え方法：{0}",
    "Shown": "表示",
    "Hidden": "非表示",
    "Excluded files: {0}": "除外ファイル：{0}",
    "Click to show or hide excluded files and folders": "クリックで除外されたファイルとフォルダの表示／非表示を切り替え",
    "Collapse all (press again to switch to expand all)": "すべて折りたたむ（もう一度押すとすべて展開に切り替わります）",
    "Expand all (press again to switch to collapse all)": "すべて展開（もう一度押すとすべて折りたたみに切り替わります）",
    "+": "+",
    "Open Focus File Manager in sidebar": "サイドバーで Focus File Manager を開く",
    "Open Focus File Manager in main area": "メインエリアで Focus File Manager を開く",
    "Show file manager only": "ファイル管理のみ表示",
    "Show focus zone only": "フォーカスゾーンのみ表示",
    "Show both": "両方を表示",
    "Cycle view (File manager → Focus zone → Both)": "表示を切り替え（ファイル管理 → フォーカスゾーン → 両方）",
    "Open tag manager in a tab": "タブでタグ管理を開く",
    "Open property manager in a tab": "タブでプロパティ管理を開く",
    "Show tag manager in the left area": "左側エリアにタグ管理を表示",
    "Show property manager in the left area": "左側エリアにプロパティ管理を表示",
    "Show file manager in the left area": "左側エリアにファイル管理を表示",
    "Locate in Focus File Manager": "Focus File Manager で場所を表示",
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
    "\"{0}\" is already at the top level": "「{0}」は既に最上位です",
    "No folder above \"{0}\" to move it into": "「{0}」の上に移動先のフォルダがありません",
    "The name contains invalid characters": "名前に使用できない文字が含まれています",
    "Delete {0} items? (moved to trash per Obsidian settings)": "{0} 件を削除しますか？（Obsidian の設定に従いごみ箱へ移動）",
    "Delete failed: ": "削除に失敗：",
    "Canvas": "キャンバス",
    "Excalidraw plugin not found; make sure it is enabled": "Excalidraw プラグインが見つかりません。有効になっているか確認してください",
    "Failed to create Excalidraw: ": "Excalidraw の作成に失敗：",
    "This file is excluded (hidden); show excluded files first": "このファイルは除外（非表示）されています。先に除外されたファイルを表示してください",
    "Open this plugin's settings under \"Settings → Community plugins\"": "「設定 → コミュニティプラグイン」からこのプラグインの設定を開いてください",
    "Today's note already exists: {0}": "今日のノートは既に存在します：{0}",
    "Daily note created: {0}": "デイリーノートを作成しました：{0}",
    "Blank daily note (no template)": "空白のデイリーノート（テンプレートなし）",
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
    "This item is hidden by the exclusion rule \"{0}\"; change it in the settings": "この項目は除外ルール「{0}」で非表示になっています。設定で変更してください",
    "Open in new tab": "新しいタブで開く",
    "Open to the right": "右側に開く",
    "Open in new window": "新しいウィンドウで開く",
    "Show in folder": "フォルダで表示",
    "Selection mode (enter / exit)": "選択モード（開始／終了）",
    "Add to focus zone…": "フォーカスゾーンに追加…",
    "Remove from focus zone": "フォーカスゾーンから削除",
    "Remove from focus zone ({0})": "フォーカスゾーンから削除（{0}）",
    "Move to temporary folder…": "一時フォルダへ移動…",
    "Move out of temporary folder": "一時フォルダから出す",
    "Copy": "コピー",
    "Cut": "切り取り",
    "Paste": "貼り付け",
    "Add / remove bookmark": "ブックマークの追加／削除",
    "Remove bookmark": "ブックマークを削除",
    "Add bookmark": "ブックマークに追加",
    "Batch rename…": "一括名前変更…",
    "Batch rename… ({0})": "一括名前変更…（{0}）",
    "Batch rename files inside folder…": "フォルダ内のファイルを一括名前変更…",
    "This folder has no files": "このフォルダにはファイルがありません",
    "Batch edit YAML…": "YAML を一括編集…",
    "Move files by tags…": "タグでファイルを移動…",
    "Move files by YAML…": "YAML でファイルを移動…",
    "Appearance (icon / color)…": "外観（アイコン／色）…",
    "Unpin": "ピン留めを解除",
    "Move down one level (into the previous folder)": "1つ下の階層へ移動（前のフォルダへ）",
    "Hide / unhide (exclude)": "非表示／再表示（除外）",
    "Unhide (remove exclusion)": "再表示（除外を解除）",
    "Hide (add exclusion)": "非表示にする（除外に追加）",
    "New note here": "ここに新規ノート",
    "New folder here": "ここに新規フォルダ",
    "New other file types here (Base, Canvas…)": "ここに他のファイル形式を新規作成（Base、キャンバス…）",
    "New {0} here": "ここに新規 {0}",
    "Properties…": "プロパティ…",
    "Tag #{0} is locked and cannot be renamed, deleted or merged": "タグ #{0} はロックされているため、名前変更・削除・統合はできません",
    "Invalid tag name (it cannot contain spaces or #)": "無効なタグ名です（空白や # は使えません）",
    "The core Search plugin is not available": "コアプラグイン「検索」が利用できません",
    "Search condition added ({0} in total)": "検索条件を追加しました（合計 {0} 件）",
    "There is no folder above to move it into": "移動先にできる上のフォルダがありません",
    "This version of Obsidian does not support setting property types from a plugin": "このバージョンの Obsidian ではプラグインからプロパティの種類を設定できません",
    "Set the type of {0} properties": "{0} 個のプロパティの種類を設定しました",
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
    "Search settings…": "設定を検索…",
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
    "When enabled, a single click only selects; open files with the open icons below (or the right-click menu)": "有効にすると、シングルクリックは選択のみになります。下の「開く」アイコン（または右クリックメニュー）でファイルを開いてください",
    "How files open": "ファイルの開き方",
    "Applies to single-click open, the right-click \"Open\" and the open icon": "シングルクリックで開く、右クリックの「開く」、開くアイコンに適用されます",
    "Open in current tab": "現在のタブで開く",
    "Show open icon": "「開く」アイコンを表示",
    "Show an \"Open\" icon beside each file (on by default)": "各ファイルの横に「開く」アイコンを表示します（デフォルトでオン）",
    "Show \"open in new tab to the right\" icon": "「右隣の新しいタブで開く」アイコンを表示",
    "Show an \"open in new tab to the right\" icon beside each file (on by default). If \"How files open\" is set to new tab, only one icon is shown": "各ファイルの横に「右隣の新しいタブで開く」アイコンを表示します（デフォルトでオン）。「ファイルの開き方」が新しいタブの場合、アイコンは1つだけ表示されます",
    "Open icons follow the sidebar": "開くアイコンをサイドバーに追従",
    "The icons stay pinned to the right edge of the visible area, so long file names never push them out of the sidebar (on by default)": "アイコンは表示領域の右端に固定され、長いファイル名でサイドバーの外へ押し出されることはありません（デフォルトでオン）",
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
    "Highlight new items": "新規項目をハイライト",
    "After creating a note, folder, etc. from the menu, the new item's background is briefly highlighted (on by default)": "メニューからノートやフォルダなどを作成した後、新しい項目の背景が一時的にハイライトされます（デフォルトでオン）",
    "Highlight color": "ハイライトの色",
    "Leave empty to use the theme's accent color. Accepts color names, RGB or HEX": "空欄 = テーマのアクセントカラーを使用します。色名、RGB、HEX を指定できます",
    "Follow theme": "テーマに従う",
    "Reset (follow theme)": "リセット（テーマに従う）",
    "Locate new items": "新規項目の位置へ移動",
    "Automatically expands parent folders and scrolls to the new item (on by default)": "親フォルダを自動で展開し、新しい項目の位置までスクロールします（デフォルトでオン）",
    "Open in the left sidebar when the plugin is enabled": "プラグイン有効化時に左サイドバーで開く",
    "When you enable this plugin manually inside Obsidian, Focus File Manager opens in the left sidebar automatically (on by default)": "Obsidian 内でこのプラグインを手動で有効にすると、左サイドバーに Focus File Manager が自動で開きます（デフォルトでオン）",
    "Maximum for batch create": "一括作成の最大数",
    "The most items one batch create can make. Default 10, maximum 50": "一度の一括作成で作れる最大数。デフォルトは 10、最大 50",
    "Show excluded files": "除外されたファイルを表示",
    "Hidden by default. You can also toggle it with the eye button on the toolbar": "デフォルトでは非表示です。ツールバーの目のボタンでも切り替えられます",
    "Exclusion list (hidden files / folders)": "除外リスト（非表示のファイル／フォルダ）",
    "One per line. Starting with / or containing / means a path (e.g. /Projects/Archive); otherwise it is a name (any item with that name). Wildcards * and ? work. \"Hide\" in the right-click menu writes here automatically": "1行に1件。/ で始まる、または / を含むものはパス（例：/Projects/Archive）、それ以外は名前（どこにある同名項目も対象）。ワイルドカード * と ? が使えます。右クリックメニューの「非表示」はここに自動で書き込まれます",
    "Tags in notes: single click edits, double click searches": "ノート内のタグ：シングルクリックで編集、ダブルクリックで検索",
    "When on (default), a single click on a tag (#tag) in a note does not jump to Obsidian's search so you can edit it directly; a double click searches for the tag": "オン（デフォルト）の場合、ノート内のタグ（#タグ）をシングルクリックしても Obsidian の検索へ移動せず、そのまま編集できます。ダブルクリックでそのタグを検索します",
    "Locate the file when clicking the file name under the tab bar": "タブバー下のファイル名をクリックしたときにファイルの場所を表示",
    "A single click on the file name locates and highlights the file in this plugin; a double click starts renaming (on by default)": "ファイル名をシングルクリックするとこのプラグインでファイルの場所を表示してハイライトします。ダブルクリックで名前の変更を開始します（デフォルトでオン）",
    "Prefer this plugin when clicking the path under the tab bar": "タブバー下のパスをクリックしたときにこのプラグインを優先",
    "When you click a folder name in the path above a note's title, this plugin locates and shows that folder (on by default)": "ノートのタイトル上のパス（フォルダ名）をクリックすると、このプラグインでそのフォルダを表示します（デフォルトでオン）",
    "Daily note template paths": "デイリーノートのテンプレートパス",
    "One path per line; each can be a template file or a folder (every .md inside a folder is listed as a template). Supports {{date}}, {{date:FORMAT}}, {{time}} and {{title}}": "1行に1つのパス。テンプレートファイルまたはフォルダを指定できます（フォルダ内のすべての .md がテンプレートとして一覧に表示されます）。{{date}}、{{date:フォーマット}}、{{time}}、{{title}} に対応",
    "Daily note file name format": "デイリーノートのファイル名形式",
    "Uses moment.js format tokens; default YYYY-MM-DD": "moment.js の書式を使用します。デフォルトは YYYY-MM-DD",
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
    "Right-click menu": "右クリックメニューの管理",
    "Reorder the items in the file and folder right-click menu, or turn off the ones you don't need (all on by default). The separator lines are listed too: move or remove them, or add your own": "ファイルとフォルダの右クリックメニューの項目の順序を変更したり、不要な項目をオフにできます（デフォルトはすべてオン）。グループの区切り線は順序に応じて自動で入ります",
    "Restore default order and switches": "既定の順序とスイッチに戻す",
    "Batch rename presets": "一括名前変更のプリセット",
    "Name pattern / numbering": "名前パターン / 連番",
    "Delete this preset": "このプリセットを削除",
    "Keep at least one preset": "プリセットは少なくとも1つ必要です",
    "{n} number, {name} original name, {ext} extension, {i} order": "{n} 連番、{name} 元の名前、{ext} 拡張子、{i} 順番",
    "One name per line, applied to the files in order": "1行に1つの名前を、ファイルへ順に適用します",
    "Add preset": "プリセットを追加",
    "New preset": "新しいプリセット",
    "No matching settings": "一致する設定はありません",
    "編號（100、200…）": "連番（100、200…）",
    "替換字符": "文字の置換",
    "Open in a tab": "タブで開く",
    "Align left": "左揃え",
    "Align center": "中央揃え",
    "Align right": "右揃え",
    "Default alignment": "既定の揃え",
    "Custom shift distance…": "移動距離を指定…",
    "Shift distance (px)": "移動距離（px）",
    "Wrap text (wrap long names instead of showing …)": "自動折り返し（長い名前を「…」で省略せず折り返す）",
    "Auto-fit this column": "この列の幅を自動調整",
    "Auto-fit all columns": "すべての列の幅を自動調整",
    "Reset this column": "この列の書式をリセット",
    "Column format…": "列の書式…",
    "Show files using this tag": "このタグを使うファイルを展開",
    "Hide files using this tag": "このタグを使うファイルを折りたたむ",
    "Sort this folder…": "このフォルダを並べ替え…",
    "{0} (including all subfolders)": "{0}（すべてのサブフォルダを含む）",
    "Sorted \"{0}\"": "「{0}」を並べ替えました",
    "Folders at the top": "フォルダを先頭に",
    "Folders at the bottom": "フォルダを末尾に",
    "Mixed by name: folder before its file": "名前で混在：フォルダを同じ接頭辞のファイルの前に",
    "Mixed by name: folder after its file": "名前で混在：フォルダを同じ接頭辞のファイルの後に",
    "Folder position": "フォルダの位置",
    "Where folders go when sorting. \"Mixed by name\" sorts files and folders together; a folder whose name starts with a file's name (for example A-image and A.md) goes right before or after that file.": "並べ替え時のフォルダの位置。「名前で混在」はファイルとフォルダを名前順にまとめて並べ、ファイル名で始まる名前のフォルダ（例：A-image と A.md）をそのファイルの直前または直後に置きます。",
    "Copy names": "名前をコピー",
    "Copied {0} names": "{0} 個の名前をコピーしました",
    "Not in any category": "未分類（既存のフォルダ分類を除く）",
    "Copied": "コピーしました",
    "Separator": "区切り線",
    "Change icon": "アイコンを変更",
    "Reset icon": "アイコンをリセット",
    "Insert a separator below": "下に区切り線を挿入",
    "Remove separator": "区切り線を削除",
    "Add separator": "区切り線を追加",
    "Search settings… (type # to jump to a section)": "設定を検索…（# で各セクションへジャンプ）",
    "No matching sections": "一致するセクションがありません"
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

/* ------------------------------ 工具：名單、萬用字元、YAML ------------------------------ */
const globRe = (x) => new RegExp('^' + x.split('').map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : escapeRe(ch))).join('') + '$', 'i');
const parseNameList = (text) => String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

function yamlSplit(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  return m ? m[1] : null;
}
function yamlParseSafe(src) {
  try {
    const v = parseYaml(src);
    return { ok: true, obj: v && typeof v === 'object' && !Array.isArray(v) ? v : {} };
  } catch (e) { return { ok: false, obj: {} }; }
}
function yamlCoerce(type, text) {
  const s = String(text === undefined || text === null ? '' : text);
  if (type === 'text') return s;
  if (type === 'list') return s.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
  if (type === 'number') { const n = Number(s); return Number.isFinite(n) && s.trim() !== '' ? n : s; }
  if (type === 'checkbox') return /^(true|1|yes|on|是|開|开)$/i.test(s.trim());
  if (type === 'date' || type === 'datetime') return s.trim();
  try { const v = parseYaml(s); return v === undefined || v === null ? s : v; } catch (e) { return s; }
}
const yamlHas = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const yamlCmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
// 依序套用操作（不修改傳入的物件）；op.files 有值時只作用在這些檔案
function yamlApplyOps(obj, ops, path) {
  let o = JSON.parse(JSON.stringify(obj || {}));
  for (const op of ops) {
    if (op.files && !op.files.includes(path)) continue;
    if (op.kind === 'add') {
      if (!op.key) continue;
      let raw = op.value;
      if (op.valueScope === 'each') {
        raw = op.values ? op.values[path] : undefined;
        if (raw === undefined || String(raw).trim() === '') continue;
      }
      const v = yamlCoerce(op.type, raw);
      if (!yamlHas(o, op.key)) o[op.key] = v;
      else if (op.exists === 'overwrite') o[op.key] = v;
      else if (op.exists === 'merge') {
        const cur = Array.isArray(o[op.key]) ? o[op.key] : o[op.key] === null || o[op.key] === '' ? [] : [o[op.key]];
        const add = Array.isArray(v) ? v : [v];
        o[op.key] = [...cur, ...add.filter((x) => !cur.some((c) => String(c) === String(x)))];
      }
    } else if (op.kind === 'edit') {
      if (!op.key || !yamlHas(o, op.key)) continue;
      let val = o[op.key];
      if (op.valueMode === 'set') {
        let raw = op.value, skip = false;
        if (op.valueScope === 'each') { raw = op.values ? op.values[path] : undefined; skip = raw === undefined || String(raw).trim() === ''; }
        if (!skip) val = yamlCoerce(op.type, raw);
      }
      else if (op.valueMode === 'replace' && op.find) {
        const rep = (x) => (typeof x === 'string' ? x.split(op.find).join(op.replace || '') : x);
        val = Array.isArray(val) ? val.map(rep) : rep(val);
      }
      if (op.newKey && op.newKey !== op.key) {
        const out = {};
        for (const [k, v] of Object.entries(o)) { if (k === op.key) out[op.newKey] = val; else if (k !== op.newKey) out[k] = v; }
        o = out;
      } else o[op.key] = val;
    } else if (op.kind === 'delete') {
      if (!op.key || !yamlHas(o, op.key)) continue;
      let rawWant = op.value;
      if (op.valueScope === 'each') {
        rawWant = op.values ? op.values[path] : undefined;
        if (rawWant === undefined || String(rawWant).trim() === '') continue;
      }
      const want = rawWant === undefined || rawWant === null ? '' : String(rawWant).trim();
      if (!want) delete o[op.key];
      else if (Array.isArray(o[op.key])) o[op.key] = o[op.key].filter((x) => String(x) !== want);
      else if (String(o[op.key]) === want) delete o[op.key];
    } else if (op.kind === 'sort') {
      if (op.target === 'values') {
        (op.key && op.key !== '*' ? [op.key] : Object.keys(o)).forEach((k) => {
          if (Array.isArray(o[k])) { const s = [...o[k]].sort(yamlCmp); o[k] = op.order === 'desc' ? s.reverse() : s; }
        });
      } else {
        const keys = Object.keys(o);
        let sorted;
        if (op.order === 'custom') {
          const first = String(op.custom || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
          sorted = [...first.filter((k) => keys.includes(k)), ...keys.filter((k) => !first.includes(k))];
        } else { sorted = [...keys].sort(yamlCmp); if (op.order === 'desc') sorted.reverse(); }
        const out = {};
        sorted.forEach((k) => { out[k] = o[k]; });
        o = out;
      }
    }
  }
  return o;
}
const yamlChanged = (a, b) => JSON.stringify(a) !== JSON.stringify(b) || Object.keys(a).join('\u0000') !== Object.keys(b).join('\u0000');
// 簡單的逐行差異（LCS），用於原始碼檢視
function lineDiff(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: 'same', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', s: a[i] }); i++; }
    else { out.push({ t: 'add', s: b[j] }); j++; }
  }
  while (i < n) out.push({ t: 'del', s: a[i++] });
  while (j < m) out.push({ t: 'add', s: b[j++] });
  return out;
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
    } else if (preset.type === 'list') {
      const names = parseNameList(preset.names);
      if (i < names.length) nb = names[i];
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
      d.addOption('__list__', _t("List replace"));
      d.setValue('0');
      d.onChange((v) => {
        this.preset = v === '__list__' ? { id: 'adhoc', name: _t("List replace"), type: 'list', names: '' } : clone(presets[Number(v)]);
        this.renderFields(); this.renderPreview();
      });
    });
    this.fieldsEl = el.createDiv();
    this.warnEl = el.createDiv({ cls: 'ffm-warn' });
    this.problemEl = el.createDiv({ cls: 'ffm-problem' });
    el.createEl('p', { cls: 'setting-item-description', text: _t("Drag the ⋮⋮ handle or use ↑ ↓ to change the order (numbering follows this order)") });
    this.previewEl = el.createDiv({ cls: 'ffm-preview' });
    new Setting(el)
      .addButton((b) => b.setButtonText(_t("Save as preset")).onClick(() => this.savePreset()))
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
    } else if (pr.type === 'list') {
      new Setting(el).setName(_t("Name list")).setDesc(_t("One name per line, applied in order to the files below (extensions are kept). Paste directly or import a text file"))
        .addTextArea((t2) => { t2.setValue(pr.names || '').onChange((v) => { pr.names = v; this.renderPreview(); }); t2.inputEl.rows = 6; t2.inputEl.style.width = '100%'; })
        .addButton((b) => b.setButtonText(_t("Import list…")).onClick(() => this.importList()));
    } else {
      text(_t("Find"), '', 'find');
      text(_t("Replace with"), '', 'replace');
      tog(_t("Use regular expression"), 'regex');
      tog(_t("Case sensitive"), 'caseSensitive');
    }
  }
  importList() {
    const input = createEl('input', { type: 'file' });
    input.accept = '.txt,.md,.csv,text/plain';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try { this.preset.names = await f.text(); this.renderFields(); this.renderPreview(); }
      catch (e) { new Notice(_t("Failed to read the file: ") + e.message); }
    };
    input.click();
  }
  savePreset() {
    const p = this.plugin;
    new TextPromptModal(this.app, _t("Preset name"), this.preset.type === 'list' ? '' : _t(this.preset.name), async (name) => {
      const entry = clone(this.preset);
      entry.id = uid(); entry.name = name;
      const list = p.settings.renamePresets;
      const k = list.findIndex((x) => x.name === name);
      if (k >= 0) list[k] = entry; else list.push(entry);
      await p.saveSettings();
      new Notice(_t("Saved preset \"{0}\"", name));
    }).open();
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
    let warn = '';
    if (this.preset.type === 'list') {
      const n = parseNameList(this.preset.names).length, mm = files.length;
      if (n > mm) warn = _t("The list has {0} names but only {1} items: the extra {2} names will not be used (you can ignore this warning)", n, mm, n - mm);
      else if (n < mm) warn = _t("The list has only {0} names but there are {1} items: the last {2} items keep their original names (you can ignore this warning)", n, mm, mm - n);
    }
    this.warnEl.setText(warn);
    if (this.applyBtn) this.applyBtn.setDisabled(!!problem);
    const el = this.previewEl; el.empty();
    const table = el.createEl('table');
    const last = this.plan.length - 1;
    const clearMarks = () => table.querySelectorAll('tr').forEach((x) => x.removeClasses(['drop-above', 'drop-below']));
    this.plan.forEach((item, idx) => {
      const tr = table.createEl('tr');
      if (item.bad) tr.addClass('is-bad');
      tr.draggable = true;
      tr.createEl('td', { cls: 'ffm-drag-handle', text: '⋮⋮' }).setAttr('aria-label', _t("Drag to reorder"));
      tr.createEl('td', { text: item.file.name });
      tr.createEl('td', { text: '→' });
      tr.createEl('td', { text: item.newName });
      const ctl = tr.createEl('td', { cls: 'ffm-row-ctl' });
      const up = ctl.createEl('button', { cls: 'ffm-x', text: '↑' });
      up.setAttr('aria-label', _t("Move up")); up.disabled = idx === 0; up.onclick = () => this.moveItem(idx, idx - 1);
      const dn = ctl.createEl('button', { cls: 'ffm-x', text: '↓' });
      dn.setAttr('aria-label', _t("Move down")); dn.disabled = idx === last; dn.onclick = () => this.moveItem(idx, idx + 1);
      const xb = ctl.createEl('button', { cls: 'ffm-x', text: '✕' });
      xb.setAttr('aria-label', _t("Remove from this batch rename"));
      xb.onclick = () => {
        this.files = this.files.filter((f) => f !== item.file);
        this.updateTitle();
        this.renderPreview();
      };
      tr.addEventListener('dragstart', (e) => {
        this.dragIdx = idx;
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); }
        tr.addClass('is-dragging');
      });
      tr.addEventListener('dragend', () => { this.dragIdx = null; tr.removeClass('is-dragging'); clearMarks(); });
      tr.addEventListener('dragover', (e) => {
        if (this.dragIdx === null || this.dragIdx === undefined) return;
        e.preventDefault();
        const r = tr.getBoundingClientRect();
        clearMarks();
        tr.addClass(e.clientY > r.top + r.height / 2 ? 'drop-below' : 'drop-above');
      });
      tr.addEventListener('drop', (e) => {
        if (this.dragIdx === null || this.dragIdx === undefined) return;
        e.preventDefault();
        const r = tr.getBoundingClientRect();
        const from = this.dragIdx;
        this.dragIdx = null;
        clearMarks();
        this.reorder(from, idx + (e.clientY > r.top + r.height / 2 ? 1 : 0));
      });
    });
  }
  reorder(from, to) {
    const a = [...this.files];
    const [it] = a.splice(from, 1);
    if (to > from) to--;
    a.splice(Math.max(0, Math.min(a.length, to)), 0, it);
    this.files = a;
    this.renderPreview();
  }
  moveItem(i, j) {
    if (j < 0 || j >= this.files.length) return;
    const a = [...this.files];
    [a[i], a[j]] = [a[j], a[i]];
    this.files = a;
    this.renderPreview();
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
    const row = (k, v) => {
      const tr = table.createEl('tr');
      tr.createEl('td', { cls: 'ffm-props-k', text: k });
      tr.createEl('td', { cls: 'ffm-props-v', text: String(v) });
      const cp = tr.createEl('td', { cls: 'ffm-props-copy' }).createSpan({ cls: 'ffm-copy-btn' });
      setIcon(cp, 'copy');
      cp.setAttr('aria-label', _t("Copy"));
      cp.onclick = async () => { try { await navigator.clipboard.writeText(String(v)); new Notice(_t("Copied")); } catch (e) { new Notice(_t("Copy failed")); } };
    };
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

class BatchCreateModal extends Modal {
  constructor(app, plugin, folder) { super(app); this.plugin = plugin; this.folder = folder; }
  onOpen() {
    const p = this.plugin, s = p.settings, el = this.contentEl;
    const max = Math.max(1, Math.min(50, Number(s.batchCreateMax) || 10));
    this.titleEl.setText(_t("Batch create"));
    const st = { type: 'note', count: Math.min(5, max), base: '', tpl: '' };
    const types = [['note', _t("Note")], ['folder', _t("Folder")], ['daily', _t("Daily note (template)")]].concat(p.newFileDefs().map((d) => ['def:' + d.id, d.label]));
    const tplList = p.dailyTemplateList();
    let tplSetting;
    new Setting(el).setName(_t("Type")).addDropdown((d) => {
      types.forEach(([k, label]) => d.addOption(k, _t(label)));
      d.setValue(st.type);
      d.onChange((v) => { st.type = v; tplSetting.settingEl.style.display = v === 'daily' ? '' : 'none'; });
    });
    tplSetting = new Setting(el).setName(_t("Daily note templates")).addDropdown((d) => {
      d.addOption('', _t("(Blank, no template)"));
      tplList.forEach((f) => d.addOption(f.path, f.basename));
      st.tpl = tplList[0] ? tplList[0].path : '';
      d.setValue(st.tpl);
      d.onChange((v) => (st.tpl = v));
    });
    tplSetting.settingEl.style.display = 'none';
    new Setting(el).setName(_t("Count")).setDesc(_t("Up to {0} (adjustable in the plugin settings, maximum 50)", max))
      .addText((t2) => t2.setValue(String(st.count)).onChange((v) => (st.count = Number(v))));
    new Setting(el).setName(_t("Name prefix")).setDesc(_t("After creating, batch rename opens automatically so you can give them the names you want"))
      .addText((t2) => t2.setPlaceholder(_t("Untitled")).onChange((v) => (st.base = v.trim())));
    new Setting(el)
      .addButton((b) => b.setButtonText(_t("Cancel")).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(_t("Create and batch rename")).setCta().onClick(async () => {
        let n = Math.floor(Number(st.count));
        if (!Number.isFinite(n) || n < 1) { new Notice(_t("Please enter a valid count")); return; }
        if (n > max) { new Notice(_t("You can create at most {0} at a time", max)); n = max; }
        this.close();
        await this.create(st, n);
      }));
  }
  async create(st, n) {
    const p = this.plugin, folder = this.folder, vault = this.app.vault;
    const base = st.base || _t("Untitled");
    const made = [];
    const def = st.type.startsWith('def:') ? p.newFileDefs().find((d) => 'def:' + d.id === st.type) : null;
    const tpl = st.type === 'daily' && st.tpl ? vault.getAbstractFileByPath(st.tpl) : null;
    const tplText = tpl instanceof TFile ? await vault.cachedRead(tpl) : '';
    try {
      for (let i = 1; i <= n; i++) {
        const label = `${base} ${i}`;
        let f = null;
        if (st.type === 'folder') {
          const path = p.uniqueVaultPath(folder.path, label, true);
          const r = await vault.createFolder(path);
          f = r && r.path ? r : vault.getAbstractFileByPath(path);
        } else if (def && def.excalidraw) {
          f = await p.createExcalidrawFile(folder, label);
        } else {
          const ext = def ? def.ext : 'md';
          const path = p.uniqueVaultPath(folder.path, `${label}.${ext}`, false);
          const content = def ? def.content || '' : st.type === 'daily' ? p.fillTemplate(tplText, label, obsidian.moment()) : '';
          f = await vault.create(path, content);
        }
        if (f) made.push(f);
      }
    } catch (e) { new Notice(_t("Create failed: ") + e.message); }
    if (!made.length) return;
    p.expandFolder(folder);
    new Notice(_t("Created {0} items", made.length));
    p.revealItem(made[0]);
    new BatchRenameModal(this.app, p, made).open();
  }
  onClose() { this.contentEl.empty(); }
}

class YamlEditModal extends Modal {
  constructor(app, plugin, files) {
    super(app);
    this.plugin = plugin; this.files = files;
    this.docs = new Map(); this.ops = [];
    this.kind = 'add'; this.view = 'preview'; this.onlyChanged = false;
    this.form = this.freshForm(); this.scopeAll = true; this.scopeSet = new Set(files.map((f) => f.path));
    this.schemeIdx = -1; this.existing = new Map(); this.vaultKeys = []; this.customOrder = null; this._vv = new Map();
  }
  freshForm() {
    return { key: '', type: 'auto', value: '', exists: 'skip', newKey: '', valueMode: 'keep', find: '', replace: '', target: 'keys', order: 'asc', custom: '', valueScope: 'follow', values: {} };
  }
  scopeFiles() { return this.scopeAll ? this.files : this.files.filter((f) => this.scopeSet.has(f.path)); }
  nowStr(type) { return obsidian.moment().format(type === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm'); }
  firstKey() { return String(this.form.key || '').split('\n')[0].split('=')[0].trim(); }
  async onOpen() {
    this.modalEl.addClass('ffm-yaml-modal');
    this.titleEl.setText(_t("Batch edit YAML ({0} files)", this.files.length));
    await this.loadDocs();
    this.topEl = this.contentEl.createDiv({ cls: 'ffm-yaml-top' });
    const body = this.contentEl.createDiv({ cls: 'ffm-yaml-body' });
    const left = body.createDiv({ cls: 'ffm-yaml-left' });
    this.formEl = left.createDiv();
    this.queueEl = left.createDiv({ cls: 'ffm-yaml-queue' });
    this.rightEl = body.createDiv({ cls: 'ffm-yaml-right' });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(_t("Cancel")).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(_t("Apply")).setCta().onClick(() => this.apply()));
    this.renderTop(); this.renderForm(); this.renderQueue(); this.renderPreview();
  }
  async loadDocs() {
    for (const f of this.files) {
      try {
        const src = yamlSplit(await this.app.vault.cachedRead(f));
        const r = src === null ? { ok: true, obj: {} } : yamlParseSafe(src);
        this.docs.set(f.path, { obj: r.obj, ok: r.ok });
      } catch (e) { this.docs.set(f.path, { obj: {}, ok: false }); }
    }
    const m = new Map();
    for (const d of this.docs.values()) {
      Object.entries(d.obj).forEach(([k, v]) => {
        const e = m.get(k) || { count: 0, values: new Map() };
        e.count++;
        (Array.isArray(v) ? v : [v]).forEach((x) => { if (x !== null && typeof x !== 'object') e.values.set(String(x), (e.values.get(String(x)) || 0) + 1); });
        m.set(k, e);
      });
    }
    this.existing = m;
    this.listKeys = new Set();
    for (const d of this.docs.values()) Object.entries(d.obj).forEach(([k, v]) => { if (Array.isArray(v)) this.listKeys.add(k); });
    try {
      const info = this.app.metadataCache.getAllPropertyInfos ? this.app.metadataCache.getAllPropertyInfos() : null;
      if (info) this.vaultKeys = Object.values(info).map((x) => x.name).filter((k) => k && !m.has(k)).sort();
    } catch (e) { /* ignore */ }
  }

  /* ---- 值的建議：選取其他筆記已有的值 ---- */
  vaultValues(key) {
    if (this._vv.has(key)) return this._vv.get(key);
    const counts = new Map();
    try {
      for (const f of this.app.vault.getMarkdownFiles()) {
        const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter;
        if (!fm || !yamlHas(fm, key)) continue;
        (Array.isArray(fm[key]) ? fm[key] : [fm[key]]).forEach((x) => { if (x !== null && x !== undefined && typeof x !== 'object') counts.set(String(x), (counts.get(String(x)) || 0) + 1); });
      }
    } catch (e) { /* ignore */ }
    const out = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    this._vv.set(key, out);
    return out;
  }
  // 只有「清單」與 tags（標籤）屬性才提供快速選取其他筆記已有的值
  isQuick(key, type) {
    const k = String(key || '').toLowerCase();
    return type === 'list' || k === 'tags' || k === 'tag' || (type === 'auto' && !!this.listKeys && this.listKeys.has(key));
  }
  candidates(key, type, text) {
    if (!key || !this.isQuick(key, type)) return [];
    const merged = new Map();
    const ex = this.existing.get(key);
    if (ex) ex.values.forEach((c, v) => merged.set(v, 1000 + c));
    this.vaultValues(key).forEach(([v, c]) => { if (!merged.has(v)) merged.set(v, c); });
    if (['tags', 'tag'].includes(String(key).toLowerCase())) {
      try { Object.entries(this.app.metadataCache.getTags() || {}).forEach(([tg, c]) => { const v = tg.replace(/^#/, ''); if (!merged.has(v)) merged.set(v, c); }); } catch (e) { /* ignore */ }
    }
    let q = String(text || '');
    if (type === 'list') q = q.split(/[,，]/).pop();
    q = q.trim().toLowerCase();
    return [...merged.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v).filter((v) => !q || v.toLowerCase().includes(q)).slice(0, 12);
  }
  pickInto(type, text, picked) {
    if (type !== 'list') return picked;
    const toks = String(text || '').split(/[,，]/);
    toks.pop();
    const done = toks.map((x) => x.trim()).filter(Boolean);
    if (!done.includes(picked)) done.push(picked);
    return done.join(', ') + ', ';
  }
  suggest(inputEl, getCands, onPick) {
    const host = inputEl && inputEl.parentElement;
    if (!host || !host.createDiv) return;
    if (host.style) host.style.position = 'relative';
    const box = host.createDiv({ cls: 'ffm-suggest' });
    box.style.display = 'none';
    const show = () => {
      const cands = getCands(inputEl.value);
      box.empty();
      if (!cands.length) { box.style.display = 'none'; return; }
      cands.forEach((c) => {
        const row = box.createDiv({ cls: 'ffm-suggest-item', text: c });
        row.addEventListener('mousedown', (ev) => { ev.preventDefault(); onPick(c); box.style.display = 'none'; });
      });
      box.style.display = '';
    };
    inputEl.addEventListener('focus', show);
    inputEl.addEventListener('input', show);
    inputEl.addEventListener('blur', () => setTimeout(() => { box.style.display = 'none'; }, 150));
  }

  /* ---- 方案（模板） ---- */
  renderTop() {
    const el = this.topEl, p = this.plugin, s = p.settings;
    el.empty();
    new Setting(el).setName(_t("Preset"))
      .addDropdown((d) => {
        d.addOption('', _t("(Load a preset…)"));
        s.yamlSchemes.forEach((x, i) => d.addOption(String(i), x.name));
        d.setValue('');
        d.onChange((v) => {
          this.schemeIdx = v === '' ? -1 : Number(v);
          const sc = s.yamlSchemes[this.schemeIdx];
          if (sc) { this.ops = JSON.parse(JSON.stringify(sc.ops)); this.customOrder = null; this.renderQueue(); this.renderPreview(); }
        });
      })
      .addButton((b) => b.setButtonText(_t("Save as preset")).onClick(() => {
        if (!this.ops.length) { new Notice(_t("There are no operations to save")); return; }
        const keep = this.ops.filter((o) => o.valueScope !== 'each');
        const dropped = this.ops.length - keep.length;
        if (!keep.length) { new Notice(_t("There are no operations to save")); return; }
        new TextPromptModal(this.app, _t("Preset name"), '', async (name) => {
          const ops = keep.map((o) => { const c = JSON.parse(JSON.stringify(o)); delete c.files; return c; });
          const k = s.yamlSchemes.findIndex((x) => x.name === name);
          if (k >= 0) s.yamlSchemes[k] = { name, ops }; else s.yamlSchemes.push({ name, ops });
          await p.saveSettings(); this.renderTop();
          new Notice(_t("Saved preset \"{0}\"", name));
          if (dropped) new Notice(_t("{0} operation(s) with per-file values cannot be saved in a preset and were skipped", dropped));
        }).open();
      }))
      .addButton((b) => b.setButtonText(_t("Delete preset")).onClick(async () => {
        if (this.schemeIdx < 0 || !s.yamlSchemes[this.schemeIdx]) { new Notice(_t("Choose the preset to delete from the dropdown first")); return; }
        s.yamlSchemes.splice(this.schemeIdx, 1); this.schemeIdx = -1;
        await p.saveSettings(); this.renderTop();
      }));
  }

  /* ---- 表單 ---- */
  renderForm() {
    const el = this.formEl, f = this.form;
    el.empty();
    const tabs = el.createDiv({ cls: 'ffm-yaml-tabs' });
    [['add', _t("Add property")], ['edit', _t("Edit property")], ['delete', _t("Delete property")], ['sort', _t("Sort properties")]].forEach(([k, label]) => {
      const tab = tabs.createDiv({ cls: 'ffm-yaml-tab', text: label });
      tab.toggleClass('is-active', this.kind === k);
      tab.onclick = () => { this.kind = k; this.renderForm(); };
    });
    new Setting(el).setName(_t("Apply to")).addDropdown((d) => {
      d.addOption('all', _t("All selected files ({0})", this.files.length)); d.addOption('some', _t("Only some files…"));
      d.setValue(this.scopeAll ? 'all' : 'some');
      d.onChange((v) => { this.scopeAll = v === 'all'; this.renderForm(); });
    });
    if (!this.scopeAll) {
      const list = el.createDiv({ cls: 'ffm-yaml-files' });
      this.files.forEach((file) => {
        const row = list.createEl('label', { cls: 'ffm-yaml-file' });
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = this.scopeSet.has(file.path);
        cb.onchange = () => {
          if (cb.checked) this.scopeSet.add(file.path); else this.scopeSet.delete(file.path);
          if (f.valueScope === 'each') this.renderForm();
        };
        row.createSpan({ text: file.path });
      });
    }
    this.valueComp = null; this.keyComp = null;
    const isAdd = this.kind === 'add';
    const needKey = this.kind !== 'sort' || f.target === 'values';
    if (this.kind === 'sort') {
      new Setting(el).setName(_t("Sort target")).addDropdown((d) => {
        d.addOption('keys', _t("Order of properties")); d.addOption('values', _t("Values of list properties"));
        d.setValue(f.target);
        d.onChange((v) => { f.target = v; this.renderForm(); });
      });
      new Setting(el).setName(_t("Sort order")).addDropdown((d) => {
        d.addOption('asc', _t("Ascending (A → Z)")); d.addOption('desc', _t("Descending (Z → A)"));
        if (f.target === 'keys') d.addOption('custom', _t("Custom order"));
        d.setValue(f.target === 'keys' || f.order !== 'custom' ? f.order : 'asc');
        d.onChange((v) => { f.order = v; this.renderForm(); });
      });
      if (f.target === 'keys' && f.order === 'custom') {
        el.createDiv({ cls: 'ffm-yaml-chip-label', text: _t("Custom property order") });
        el.createEl('p', { cls: 'setting-item-description', text: _t("Drag the ⋮⋮ handle or use ↑ ↓ to reorder; properties higher in the list come first") });
        this.sortHost = el.createDiv({ cls: 'ffm-yaml-sortlist' });
        this.renderSortList();
      }
    }
    if (needKey) {
      const st = new Setting(el).setName(_t("Property name"));
      if (isAdd) st.setDesc(_t("One property name per line; you can also write \"name=value\" to set the value directly"));
      else if (this.kind === 'sort') st.setDesc(_t("Leave empty = all list properties"));
      if (isAdd) {
        st.addTextArea((t2) => { this.keyComp = t2; t2.setPlaceholder('status\npriority=high').setValue(f.key).onChange((v) => { f.key = v; this.renderChips(); }); t2.inputEl.rows = 3; t2.inputEl.style.width = '100%'; });
      } else {
        st.addText((t2) => { this.keyComp = t2; t2.setPlaceholder('status').setValue(f.key).onChange((v) => { f.key = v.trim(); this.renderChips(); }); });
      }
      this.chipsEl = el.createDiv({ cls: 'ffm-yaml-chips' });
    } else this.chipsEl = null;

    const typeField = () => new Setting(el).setName(_t("Value type")).addDropdown((d) => {
      d.addOption('auto', _t("Auto-detect")); d.addOption('text', _t("Text")); d.addOption('list', _t("List (comma-separated)")); d.addOption('number', _t("Number"));
      d.addOption('checkbox', _t("Checkbox (true / false)")); d.addOption('date', _t("Date")); d.addOption('datetime', _t("Date and time"));
      d.setValue(f.type); d.onChange((v) => { f.type = v; this.renderForm(); });
    });
    const scopeOpt = () => new Setting(el).setName(_t("Value scope")).addDropdown((d) => {
      d.addOption('follow', _t("Follow the apply scope (enter it once)")); d.addOption('each', _t("Enter each value separately (a different value per file)"));
      d.setValue(f.valueScope); d.onChange((v) => { f.valueScope = v; this.renderForm(); });
    });
    const valueField = (label, desc) => {
      const st = new Setting(el).setName(label).setDesc(desc || '');
      const dt = f.type === 'date' || f.type === 'datetime';
      st.addText((t2) => {
        this.valueComp = t2;
        if (dt) t2.inputEl.type = f.type === 'date' ? 'date' : 'datetime-local';
        t2.setValue(f.value).onChange((v) => (f.value = v));
        if (!dt) this.suggest(t2.inputEl, (txt) => this.candidates(this.firstKey(), f.type, txt), (c) => { const nv = this.pickInto(f.type, t2.inputEl.value, c); f.value = nv; t2.setValue(nv); });
      });
      if (dt) st.addButton((b) => b.setButtonText(f.type === 'date' ? _t("Today") : _t("Now")).onClick(() => { f.value = this.nowStr(f.type); this.valueComp.setValue(f.value); }));
    };
    const valueArea = (label, desc) => { scopeOpt(); if (f.valueScope === 'each') this.renderEach(el); else valueField(label, desc); };

    if (this.kind === 'add') {
      typeField(); valueArea(_t("Value"));
      new Setting(el).setName(_t("If the property already exists")).addDropdown((d) => {
        d.addOption('skip', _t("Skip")); d.addOption('overwrite', _t("Overwrite")); d.addOption('merge', _t("Merge into a list"));
        d.setValue(f.exists); d.onChange((v) => (f.exists = v));
      });
    } else if (this.kind === 'edit') {
      new Setting(el).setName(_t("New property name")).setDesc(_t("Leave empty = keep the name"))
        .addText((t2) => t2.setValue(f.newKey).onChange((v) => (f.newKey = v.trim())));
      new Setting(el).setName(_t("Value handling")).addDropdown((d) => {
        d.addOption('keep', _t("Keep the value")); d.addOption('set', _t("Set to a new value")); d.addOption('replace', _t("Find and replace"));
        d.setValue(f.valueMode); d.onChange((v) => { f.valueMode = v; this.renderForm(); });
      });
      if (f.valueMode === 'set') { typeField(); valueArea(_t("New value")); }
      if (f.valueMode === 'replace') {
        new Setting(el).setName(_t("Find")).addText((t2) => t2.setValue(f.find).onChange((v) => (f.find = v)));
        new Setting(el).setName(_t("Replace with")).addText((t2) => t2.setValue(f.replace).onChange((v) => (f.replace = v)));
      }
    } else if (this.kind === 'delete') {
      scopeOpt();
      if (f.valueScope === 'each') this.renderEach(el);
      else valueField(_t("Delete only this value"), _t("Leave empty = delete the whole property. For list properties, only matching items are removed"));
    }
    new Setting(el).addButton((b) => b.setButtonText(_t("Convert (preview only, no files are changed)")).setCta().onClick(() => this.convert()));
    this.renderChips();
  }

  /* ---- 獨立輸入每個值 ---- */
  renderEach(el) {
    const f = this.form, files = this.scopeFiles();
    const type = this.kind === 'delete' ? 'text' : f.type;
    const dt = type === 'date' || type === 'datetime';
    let area = null;
    const join = () => files.map((x) => f.values[x.path] || '').join('\n');
    el.createEl('p', { cls: 'setting-item-description', text: _t("A blank line or box = that file is left alone. Fill in one value per line (in the file order below) or type or pick a value in each file's box") });
    if (dt) {
      const bar = el.createDiv({ cls: 'ffm-yaml-chip-row' });
      const all = bar.createEl('button', { cls: 'ffm-btn', text: type === 'date' ? _t("Set all to today") : _t("Set all to now") });
      all.onclick = () => { const v = this.nowStr(type); files.forEach((x) => { f.values[x.path] = v; }); this.renderForm(); };
    }
    new Setting(el).setName(_t("One value per line")).setDesc(_t("{0} files, matched in the order below", files.length))
      .addTextArea((t2) => {
        area = t2;
        t2.setValue(join()).onChange((v) => {
          const lines = v.split(/\r?\n/);
          files.forEach((x, i) => { f.values[x.path] = (lines[i] || '').trim(); });
          drawBoxes();
        });
        t2.inputEl.rows = Math.min(8, Math.max(3, files.length)); t2.inputEl.style.width = '100%';
      });
    const boxes = el.createDiv({ cls: 'ffm-yaml-each' });
    const drawBoxes = () => {
      boxes.empty();
      files.forEach((file) => {
        const row = boxes.createDiv({ cls: 'ffm-yaml-each-row' });
        row.createSpan({ cls: 'ffm-yaml-each-name', text: file.basename });
        const wrap = row.createDiv({ cls: 'ffm-yaml-each-wrap' });
        const inp = wrap.createEl('input', { type: dt ? (type === 'date' ? 'date' : 'datetime-local') : 'text', cls: 'ffm-yaml-each-input' });
        inp.value = f.values[file.path] || '';
        const sync = () => { f.values[file.path] = inp.value; if (area) area.setValue(join()); };
        inp.addEventListener('input', sync);
        if (!dt) this.suggest(inp, (txt) => this.candidates(this.firstKey(), type, txt), (c) => { inp.value = this.pickInto(type, inp.value, c); sync(); });
      });
    };
    drawBoxes();
  }

  /* ---- 自訂屬性順序（拖動） ---- */
  currentKeys() {
    const seen = new Set(), out = [];
    this.files.forEach((file) => {
      const d = this.docs.get(file.path);
      if (!d || !d.ok) return;
      Object.keys(yamlApplyOps(d.obj, this.ops, file.path)).forEach((k) => { if (!seen.has(k)) { seen.add(k); out.push(k); } });
    });
    return out;
  }
  renderSortList() {
    const host = this.sortHost;
    if (!host) return;
    host.empty();
    const keys = this.currentKeys();
    const cur = (this.customOrder || []).filter((k) => keys.includes(k));
    keys.forEach((k) => { if (!cur.includes(k)) cur.push(k); });
    this.customOrder = cur;
    if (!cur.length) { host.createDiv({ cls: 'ffm-empty', text: _t("(There are no properties to sort yet)") }); return; }
    const clear = () => host.querySelectorAll('.ffm-yaml-sort-row').forEach((x) => x.removeClasses(['drop-above', 'drop-below']));
    const move = (i, j) => { if (j < 0 || j >= cur.length) return; [cur[i], cur[j]] = [cur[j], cur[i]]; this.customOrder = cur; this.renderSortList(); };
    cur.forEach((k, idx) => {
      const row = host.createDiv({ cls: 'ffm-yaml-sort-row' });
      row.draggable = true;
      row.createSpan({ cls: 'ffm-drag-handle', text: '⋮⋮' }).setAttr('aria-label', _t("Drag to reorder"));
      row.createSpan({ cls: 'ffm-yaml-sort-name', text: k });
      const up = row.createEl('button', { cls: 'ffm-x', text: '↑' });
      up.setAttr('aria-label', _t("Move up")); up.disabled = idx === 0; up.onclick = () => move(idx, idx - 1);
      const dn = row.createEl('button', { cls: 'ffm-x', text: '↓' });
      dn.setAttr('aria-label', _t("Move down")); dn.disabled = idx === cur.length - 1; dn.onclick = () => move(idx, idx + 1);
      row.addEventListener('dragstart', (e) => { this.sortDrag = idx; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', k); } row.addClass('is-dragging'); });
      row.addEventListener('dragend', () => { this.sortDrag = null; row.removeClass('is-dragging'); clear(); });
      row.addEventListener('dragover', (e) => {
        if (this.sortDrag === null || this.sortDrag === undefined) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        clear(); row.addClass(e.clientY > r.top + r.height / 2 ? 'drop-below' : 'drop-above');
      });
      row.addEventListener('drop', (e) => {
        if (this.sortDrag === null || this.sortDrag === undefined) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        let to = idx + (e.clientY > r.top + r.height / 2 ? 1 : 0);
        const from = this.sortDrag;
        this.sortDrag = null; clear();
        const [it] = cur.splice(from, 1);
        if (to > from) to--;
        cur.splice(Math.max(0, Math.min(cur.length, to)), 0, it);
        this.customOrder = cur;
        this.renderSortList();
      });
    });
  }

  renderChips() {
    const el = this.chipsEl, f = this.form;
    if (!el) return;
    el.empty();
    const ex = this.existing;
    const multi = this.kind === 'add' && String(f.key || '').split('\n').filter((x) => x.trim()).length > 1;
    const k0 = this.firstKey();
    if (k0 && ex.has(k0) && this.kind !== 'sort' && !multi && f.valueScope !== 'each' && this.isQuick(k0, f.type)) {
      const vals = [...ex.get(k0).values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
      if (vals.length) {
        el.createDiv({ cls: 'ffm-yaml-chip-label', text: _t("Existing values (click to use)") });
        const row = el.createDiv({ cls: 'ffm-yaml-chip-row' });
        vals.forEach(([v, c]) => {
          const chip = row.createSpan({ cls: 'ffm-yaml-chip', text: `${v} (${c})` });
          chip.onclick = () => {
            const nv = this.pickInto(f.type, f.value, v);
            f.value = nv;
            if (this.valueComp) this.valueComp.setValue(nv);
          };
        });
      }
    }
    const useKey = (k) => {
      f.key = this.kind === 'add' && f.key.trim() ? (f.key.split('\n').map((x) => x.trim()).includes(k) ? f.key : f.key.replace(/\n+$/, '') + '\n' + k) : k;
      if (this.keyComp) this.keyComp.setValue(f.key);
      this.renderChips();
    };
    const keys = [...ex.entries()].sort((a, b) => b[1].count - a[1].count);
    if (keys.length) {
      el.createDiv({ cls: 'ffm-yaml-chip-label', text: _t("Existing properties (click to use)") });
      const row = el.createDiv({ cls: 'ffm-yaml-chip-row' });
      keys.forEach(([k, v]) => { row.createSpan({ cls: 'ffm-yaml-chip', text: `${k} (${v.count})` }).onclick = () => useKey(k); });
    }
    if (this.vaultKeys.length) {
      el.createDiv({ cls: 'ffm-yaml-chip-label', text: _t("Properties used elsewhere in the vault") });
      const folders = this.plugin.settings.propFolders || [];
      if (folders.length) {
        const sel = el.createEl('select', { cls: 'dropdown ffm-yaml-cat' });
        sel.createEl('option', { value: '', text: _t("All") });
        sel.createEl('option', { value: 'none', text: _t("Not in any category") });
        folders.forEach((fo, i) => sel.createEl('option', { value: String(i), text: fo.name }));
        sel.value = this.vaultFolder === undefined ? '' : String(this.vaultFolder);
        sel.onchange = () => { this.vaultFolder = sel.value; this.renderChips(); };
      }
      const categorized = new Set(folders.flatMap((fo) => fo.props || []));
      const cat = this.vaultFolder !== undefined && this.vaultFolder !== '' && this.vaultFolder !== 'none' ? folders[Number(this.vaultFolder)] : null;
      const shownKeys = this.vaultFolder === 'none' ? this.vaultKeys.filter((k) => !categorized.has(k)) : cat ? this.vaultKeys.filter((k) => (cat.props || []).includes(k)) : this.vaultKeys;
      const row = el.createDiv({ cls: 'ffm-yaml-chip-row' });
      shownKeys.slice(0, 40).forEach((k) => { row.createSpan({ cls: 'ffm-yaml-chip is-dim', text: k }).onclick = () => useKey(k); });
    }
  }
  convert() {
    const f = this.form, kind = this.kind;
    if (!this.scopeAll && !this.scopeSet.size) { new Notice(_t("Please choose at least one file")); return; }
    const files = this.scopeAll ? null : [...this.scopeSet];
    const usesValue = kind === 'add' || kind === 'delete' || (kind === 'edit' && f.valueMode === 'set');
    const each = usesValue && f.valueScope === 'each';
    let values = {};
    if (each) {
      this.scopeFiles().forEach((file) => { const v = f.values[file.path]; if (v !== undefined && String(v).trim() !== '') values[file.path] = v; });
      if (!Object.keys(values).length) { new Notice(_t("Please enter at least one value")); return; }
    }
    const make = (extra) => Object.assign({}, f, { kind, files, valueScope: each ? 'each' : 'follow', values: each ? values : {} }, extra);
    if (kind === 'add') {
      const lines = String(f.key || '').split('\n').map((x) => x.trim()).filter(Boolean);
      if (!lines.length) { new Notice(_t("Please enter a property name first")); return; }
      if (each && lines.length > 1) { new Notice(_t("\"Enter each value separately\" works with a single property name only")); return; }
      lines.forEach((line) => {
        const i = line.indexOf('=');
        this.ops.push(make({ key: i > 0 ? line.slice(0, i).trim() : line, value: i > 0 ? line.slice(i + 1).trim() : f.value }));
      });
    } else {
      if (kind !== 'sort' && !f.key) { new Notice(_t("Please enter a property name first")); return; }
      const extra = {};
      if (kind === 'sort' && f.target === 'keys' && f.order === 'custom') extra.custom = (this.customOrder || []).join('\n');
      this.ops.push(make(extra));
    }
    this.form = this.freshForm();
    this.renderForm(); this.renderQueue(); this.renderPreview();
  }

  /* ---- 待套用的操作 ---- */
  opSummary(op) {
    const scope = op.files ? ' · ' + _t("Only {0} files", op.files.length) : '';
    const each = op.valueScope === 'each';
    let text = '';
    if (op.kind === 'add') text = each ? _t("Add property {0} (a different value per file)", op.key) : _t("Add property {0} = {1}", op.key, op.value);
    else if (op.kind === 'edit') {
      const parts = [];
      if (op.newKey && op.newKey !== op.key) parts.push(_t("Rename {0} to {1}", op.key, op.newKey));
      if (op.valueMode === 'set') parts.push(each ? _t("Set the value of {0} separately per file", op.key) : _t("Set the value of {0} to {1}", op.key, op.value));
      if (op.valueMode === 'replace') parts.push(_t("In the value of {0}, replace \"{1}\" with \"{2}\"", op.key, op.find, op.replace));
      text = parts.length ? parts.join(_t("; ")) : _t("Edit property {0}", op.key);
    } else if (op.kind === 'delete') text = each ? _t("Delete a different value from {0} per file", op.key) : op.value ? _t("Delete the value {1} from {0}", op.key, op.value) : _t("Delete property {0}", op.key);
    else {
      const ord = op.order === 'desc' ? _t("Descending (Z → A)") : op.order === 'custom' ? _t("Custom order") : _t("Ascending (A → Z)");
      text = op.target === 'values' ? _t("Sort the values of {0} ({1})", op.key || '*', ord) : _t("Sort properties ({0})", ord);
    }
    return text + scope;
  }
  renderQueue() {
    const el = this.queueEl;
    el.empty();
    el.createDiv({ cls: 'ffm-yaml-chip-label', text: _t("Pending operations ({0})", this.ops.length) });
    if (!this.ops.length) el.createDiv({ cls: 'ffm-empty', text: _t("No operations yet. Fill in the form above and press \"Convert\".") });
    this.ops.forEach((op, i) => {
      const row = el.createDiv({ cls: 'ffm-yaml-op' });
      row.createSpan({ cls: 'ffm-yaml-op-text', text: this.opSummary(op) });
      const edit = row.createSpan({ cls: 'ffm-x', text: '✎' });
      edit.setAttr('aria-label', _t("Edit this operation"));
      edit.onclick = () => {
        this.ops.splice(i, 1);
        this.kind = op.kind;
        this.form = Object.assign(this.freshForm(), op, { values: Object.assign({}, op.values || {}) });
        if (op.kind === 'sort' && op.order === 'custom') this.customOrder = String(op.custom || '').split('\n').filter(Boolean);
        if (op.files) { this.scopeAll = false; this.scopeSet = new Set(op.files); } else this.scopeAll = true;
        this.renderForm(); this.renderQueue(); this.renderPreview();
      };
      const del = row.createSpan({ cls: 'ffm-x', text: '✕' });
      del.setAttr('aria-label', _t("Remove this operation"));
      del.onclick = () => { this.ops.splice(i, 1); this.renderQueue(); this.renderPreview(); if (this.sortHost) this.renderSortList(); };
    });
  }

  /* ---- 預覽（原始碼／預覽） ---- */
  renderPreview() {
    const el = this.rightEl;
    el.empty();
    const bar = el.createDiv({ cls: 'ffm-yaml-viewbar' });
    [['preview', _t("Preview")], ['source', _t("Source")]].forEach(([k, label]) => {
      const b = bar.createEl('button', { cls: 'ffm-btn', text: label });
      b.toggleClass('is-on', this.view === k);
      b.onclick = () => { this.view = k; this.renderPreview(); };
    });
    const lab = bar.createEl('label', { cls: 'ffm-yaml-only' });
    const cb = lab.createEl('input', { type: 'checkbox' });
    cb.checked = this.onlyChanged;
    cb.onchange = () => { this.onlyChanged = cb.checked; this.renderPreview(); };
    lab.createSpan({ text: _t("Show only changed files") });
    let shown = 0;
    this.files.forEach((file) => {
      const d = this.docs.get(file.path);
      const next = d && d.ok ? yamlApplyOps(d.obj, this.ops, file.path) : null;
      const changed = !!next && yamlChanged(d.obj, next);
      if (this.onlyChanged && !changed) return;
      shown++;
      const card = el.createDiv({ cls: 'ffm-yaml-card' });
      const head = card.createDiv({ cls: 'ffm-yaml-card-head' });
      head.createSpan({ cls: 'ffm-yaml-card-name', text: file.path });
      head.createSpan({ cls: 'ffm-yaml-badge' + (changed ? ' is-changed' : ''), text: !d || !d.ok ? _t("Invalid YAML, skipped") : changed ? _t("Changed") : _t("Unchanged") });
      if (!d || !d.ok) return;
      if (this.view === 'source') this.renderSource(card, d.obj, next);
      else this.renderTable(card, d.obj, next);
    });
    if (!shown) el.createDiv({ cls: 'ffm-empty', text: _t("No matching files") });
  }
  renderSource(card, oldObj, newObj) {
    const wrap = (o) => { const t2 = Object.keys(o).length ? stringifyYaml(o).trimEnd() : ''; return ('---\n' + t2 + (t2 ? '\n' : '') + '---').split('\n'); };
    const pre = card.createEl('pre', { cls: 'ffm-yaml-src' });
    lineDiff(wrap(oldObj), wrap(newObj)).forEach((x) => {
      pre.createDiv({ cls: 'ffm-yaml-line is-' + x.t, text: (x.t === 'add' ? '+ ' : x.t === 'del' ? '- ' : '  ') + x.s });
    });
  }
  renderTable(card, oldObj, newObj) {
    const table = card.createEl('table', { cls: 'ffm-yaml-table' });
    const head = table.createEl('tr');
    head.createEl('th', { text: _t("Properties") }); head.createEl('th', { text: _t("Value") });
    const fmt = (v) => (Array.isArray(v) ? v.join(', ') : v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v === null ? '' : v));
    const row = (k, v, cls) => { const tr = table.createEl('tr', { cls }); tr.createEl('td', { text: k }); tr.createEl('td', { text: fmt(v) }); };
    Object.keys(newObj).forEach((k) => {
      const had = Object.prototype.hasOwnProperty.call(oldObj, k);
      row(k, newObj[k], !had ? 'is-add' : JSON.stringify(oldObj[k]) !== JSON.stringify(newObj[k]) ? 'is-edit' : '');
    });
    Object.keys(oldObj).forEach((k) => { if (!Object.prototype.hasOwnProperty.call(newObj, k)) row(k, oldObj[k], 'is-del'); });
    if (!Object.keys(newObj).length && !Object.keys(oldObj).length) card.createDiv({ cls: 'ffm-empty', text: _t("(No properties)") });
  }

  /* ---- 套用 ---- */
  async apply() {
    if (!this.ops.length) { new Notice(_t("There are no operations to apply")); return; }
    let n = 0, skipped = 0;
    for (const f of this.files) {
      const d = this.docs.get(f.path);
      if (!d || !d.ok) { skipped++; continue; }
      if (!yamlChanged(d.obj, yamlApplyOps(d.obj, this.ops, f.path))) continue;
      try {
        await this.app.fileManager.processFrontMatter(f, (fm) => {
          const cur = yamlApplyOps(fm, this.ops, f.path);
          Object.keys(fm).forEach((k) => { delete fm[k]; });
          Object.keys(cur).forEach((k) => { fm[k] = cur[k]; });
        });
        n++;
      } catch (e) { skipped++; }
    }
    new Notice(skipped ? _t("Updated {0} files, skipped {1}", n, skipped) : _t("Updated {0} files", n));
    this.close();
  }
  onClose() { this.contentEl.empty(); }
}

/* ------------------------------ 標籤／屬性管理：工具 ------------------------------ */
const pad3 = (n) => String(n).padStart(3, '0');
function fmtAgo(ms) {
  if (!ms) return '—';
  const d = Date.now() - ms;
  if (d < 0) return '0 m';
  const m = Math.floor(d / 60000);
  if (m < 60) return m + ' m';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h';
  const days = Math.floor(h / 24);
  if (days < 365) return days + ' d';
  return Math.floor(days / 365) + ' y';
}
function levenshtein(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[m];
}
const normTag = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function tagSimilarity(a, b) {
  const x = normTag(a), y = normTag(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}
// 找出相似的標籤並分組（union-find）
function findSimilarGroups(tags, threshold) {
  const list = [...tags].slice(0, 2000);
  const parent = list.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < list.length; i++) {
    const a = normTag(list[i]);
    for (let j = i + 1; j < list.length; j++) {
      const b = normTag(list[j]);
      if (!a || !b || Math.abs(a.length - b.length) / Math.max(a.length, b.length) > 1 - threshold + 1e-9) continue;
      if (tagSimilarity(list[i], list[j]) >= threshold - 1e-9) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  list.forEach((t, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); });
  return [...groups.values()].filter((g) => g.length > 1);
}
// 輸入框的建議清單（下拉）
function attachSuggest(inputEl, getCands, onPick) {
  const host = inputEl && inputEl.parentElement;
  if (!host || !host.createDiv) return;
  if (host.style) host.style.position = 'relative';
  const box = host.createDiv({ cls: 'ffm-suggest' });
  box.style.display = 'none';
  const show = () => {
    const cands = getCands(inputEl.value);
    box.empty();
    if (!cands.length) { box.style.display = 'none'; return; }
    cands.forEach((c) => {
      const row = box.createDiv({ cls: 'ffm-suggest-item', text: c });
      row.addEventListener('mousedown', (ev) => { ev.preventDefault(); onPick(c); box.style.display = 'none'; });
    });
    box.style.display = '';
  };
  inputEl.addEventListener('focus', show);
  inputEl.addEventListener('input', show);
  inputEl.addEventListener('blur', () => setTimeout(() => { box.style.display = 'none'; }, 150));
}
// 管理面板的工具列按鈕（跟隨「頂部按鈕外觀」設定）
function panelBtn(plugin, parent, spec) {
  const st = plugin.settings.toolbarStyle || 'text';
  const b = st === 'icon' ? parent.createDiv({ cls: ['clickable-icon', 'ffm-ibtn'] }) : parent.createEl('button', { cls: 'ffm-btn' });
  b.empty();
  if (st === 'icon') setIcon(b, pickIcon(spec.icon));
  else {
    if (st === 'icon-text') setIcon(b.createSpan({ cls: 'ffm-btn-icon' }), pickIcon(spec.icon));
    b.createSpan({ text: _t(spec.label) });
  }
  b.setAttr('aria-label', spec.tip || _t(spec.label));
  b.toggleClass('is-on', !!spec.on);
  if (spec.onclick) b.onclick = spec.onclick;
  return b;
}
const PROP_TYPES = [
  ['text', "Text", 'text'], ['multitext', "List", 'list'], ['number', "Number", 'binary'], ['checkbox', "Checkbox", 'check-square'],
  ['date', "Date", 'calendar'], ['datetime', "Date and time", 'calendar-clock|clock'], ['tags', "Tags", 'tags'], ['aliases', "Aliases", 'forward'],
];
const propTypeLabel = (t) => { const x = PROP_TYPES.find((p) => p[0] === t); return x ? _t(x[1]) : t; };
const propTypeIcon = (t) => { const x = PROP_TYPES.find((p) => p[0] === t); return x ? x[2] : 'text'; };

/* ------------------------------ 標籤管理面板 ------------------------------ */
class TagPanel {
  constructor(plugin, host) {
    this.plugin = plugin; this.host = host;
    this.sel = new Set(); this.selectMode = false; this.searchOn = false; this.query = '';
    this.rows = []; this.containers = []; this.lastClicked = null; this.dragKeys = null; this.expandNext = 'expand';
  }
  get s() { return this.plugin.settings; }
  cfg() {
    const s = this.s;
    if (!s.tagPanel) s.tagPanel = {};
    if (!s.tagPanel.sort) s.tagPanel.sort = 'name-asc';
    if (s.tagPanel.nested === undefined) s.tagPanel.nested = false;
    return s.tagPanel;
  }
  cols() { return Object.assign({ num: 56, state: 44, name: 220, note: 200, last: 76, count: 64 }, this.s[this.colsField()] || {}); }
  tpl() { const c = this.cols(); return `${c.num}px ${c.state}px ${c.name}px ${c.note}px ${c.last}px ${c.count}px`; }
  totalWidth() { const c = this.cols(); return c.num + c.state + c.name + c.note + c.last + c.count; }
  isOpen(key, def) { const v = (this.s.tagExpanded || {})[key]; return v === undefined ? def : v; }
  sortName(k) {
    if (k === 'name-desc') return _t("Tag name Z → A");
    if (k === 'used-desc') return _t("Last used: newest first");
    if (k === 'used-asc') return _t("Last used: oldest first");
    if (k === 'manual') return _t("Manual order");
    return _t("Tag name A → Z");
  }

  render() {
    const host = this.host;
    const keep = this.scroller ? this.scroller.scrollTop : 0;
    host.empty();
    host.addClass('ffm-panel');
    this.buildBar(host.createDiv({ cls: 'ffm-panel-bar' }));
    this.searchWrap = host.createDiv({ cls: 'ffm-panel-search' });
    this.renderSearch();
    this.scroller = host.createDiv({ cls: 'ffm-panel-scroll' });
    this.headEl = this.scroller.createDiv({ cls: 'ffm-panel-head' });
    this.bodyEl = this.scroller.createDiv({ cls: 'ffm-panel-body' });
    this.scroller.tabIndex = 0;
    this.scroller.addEventListener('keydown', (e) => this.onKey(e));
    this.bodyEl.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showMenu(e, null); });
    this.renderHead(); this.renderBody();
    this.scroller.scrollTop = keep;
  }
  buildBar(bar) {
    const p = this.plugin, c = this.cfg();
    panelBtn(p, bar, { icon: 'arrow-up-down', label: _t("Sort: {0}", this.sortName(c.sort)), tip: _t("Sort order"), onclick: (e) => this.sortMenu(e) });
    panelBtn(p, bar, { icon: 'list-tree', label: _t("Show nested tags"), tip: _t("Show nested tags"), on: !!c.nested, onclick: () => { c.nested = !c.nested; p.saveSoon(); this.render(); } });
    const collapse = this.expandNext === 'collapse';
    panelBtn(p, bar, {
      icon: collapse ? 'chevrons-down-up|chevron-up' : 'chevrons-up-down|chevron-down', label: collapse ? _t("Collapse all") : _t("Expand all"), tip: collapse ? _t("Collapse all") : _t("Expand all"),
      onclick: () => this.toggleAll(),
    });
    panelBtn(p, bar, { icon: 'search', label: _t("Search"), tip: _t("Search tags and their notes"), on: this.searchOn, onclick: () => { this.searchOn = !this.searchOn; if (!this.searchOn) this.query = ''; this.render(); } });
    panelBtn(p, bar, { icon: 'copy-check|copy', label: _t("Remove duplicate tags"), tip: _t("Find similar tags and merge or delete them"), onclick: () => new DedupeTagsModal(p.app, p).open() });
    if (!this.standalone) panelBtn(p, bar, { icon: 'plus', label: '＋', tip: _t("Open in a tab"), onclick: () => p.openManagerTab('tags') }).addClass('ffm-push-right');
  }
  renderSearch() {
    const w = this.searchWrap;
    w.empty();
    w.style.display = this.searchOn ? '' : 'none';
    if (!this.searchOn) return;
    const input = w.createEl('input', { type: 'search', cls: 'ffm-panel-search-input' });
    input.placeholder = _t("Search tags and their notes…");
    input.value = this.query;
    input.addEventListener('input', () => { this.query = input.value; this.renderBody(); });
    setTimeout(() => { if (input.focus) input.focus(); }, 0);
  }
  sortMenu(e) {
    const c = this.cfg(), p = this.plugin, m = new Menu();
    ['name-asc', 'name-desc', 'used-desc', 'used-asc', 'manual'].forEach((k) => {
      m.addItem((i) => i.setTitle(this.sortName(k)).setChecked(c.sort === k).onClick(() => { c.sort = k; p.saveSoon(); this.render(); }));
    });
    m.showAtMouseEvent(e);
  }
  toggleAll() {
    const s = this.s;
    if (!s.tagExpanded) s.tagExpanded = {};
    if (this.expandNext === 'collapse') { this.containers.forEach((k) => { s.tagExpanded[k] = false; }); this.expandNext = 'expand'; }
    else { this.containers.forEach((k) => { s.tagExpanded[k] = true; }); this.expandNext = 'collapse'; }
    this.plugin.saveSoon();
    this.render();
  }

  renderHead() {
    const head = this.headEl, c = this.cols();
    head.empty();
    head.style.gridTemplateColumns = this.tpl();
    head.style.minWidth = this.totalWidth() + 'px';
    [['num', _t("No.")], ['state', _t("Status")], ['name', _t("Tag name")], ['note', _t("Tag note")], ['last', _t("Last used")], ['count', _t("Count")]].forEach(([k, label]) => {
      const cell = head.createDiv({ cls: 'ffm-panel-hcell' });
      cell.createSpan({ cls: 'ffm-cell-text', text: label });
      const grip = cell.createDiv({ cls: 'ffm-col-grip' });
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const startX = e.clientX, startW = c[k];
        grip.setPointerCapture(e.pointerId);
        const move = (ev) => { c[k] = Math.max(32, Math.round(startW + ev.clientX - startX)); this.s[this.colsField()] = Object.assign({}, c); this.applyWidths(); };
        const up = (ev) => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); try { grip.releasePointerCapture(ev.pointerId); } catch (err) { /* ignore */ } this.plugin.saveSoon(); };
        grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
      });
    });
  }
  applyWidths() {
    const tpl = this.tpl(), w = this.totalWidth() + 'px';
    this.headEl.style.gridTemplateColumns = tpl; this.headEl.style.minWidth = w;
    this.bodyEl.querySelectorAll('.ffm-panel-row').forEach((r) => { r.style.gridTemplateColumns = tpl; });
    this.bodyEl.style.minWidth = w;
  }

  /* ---- 資料模型 ---- */
  buildModel() {
    const p = this.plugin, s = this.s, c = this.cfg();
    const data = p.tagData();
    const meta = s.tagMeta || {};
    const q = this.query.trim().toLowerCase();
    const lastOf = (tag) => (meta[tag] && meta[tag].lastUsed) || (data.get(tag) ? data.get(tag).mtime : 0);
    const matchTag = (tag) => !q || tag.toLowerCase().includes(q) || String((meta[tag] && meta[tag].note) || '').toLowerCase().includes(q);
    const order = new Map((s.tagOrder || []).map((t, i) => [t, i]));
    const cmp = (a, b) => {
      if (c.sort === 'name-desc') return yamlCmp(b.path, a.path);
      if (c.sort === 'used-desc') return (b.last - a.last) || yamlCmp(a.path, b.path);
      if (c.sort === 'used-asc') return (a.last - b.last) || yamlCmp(a.path, b.path);
      if (c.sort === 'manual') return ((order.has(a.path) ? order.get(a.path) : 1e9) - (order.has(b.path) ? order.get(b.path) : 1e9)) || yamlCmp(a.path, b.path);
      return yamlCmp(a.path, b.path);
    };
    this.containers = [];
    const flat = (tags, depth) => tags.filter(matchTag).map((t) => ({ path: t, last: lastOf(t), count: data.get(t).count })).sort(cmp)
      .map((x) => ({ type: 'tag', path: x.path, label: x.path, depth, count: x.count, last: x.last, hasKids: false, real: true }));
    const nestedRows = (tags, depth) => {
      const root = { children: new Map() };
      tags.forEach((t) => {
        let node = root, acc = '';
        t.split('/').forEach((seg, i, arr) => {
          acc = acc ? acc + '/' + seg : seg;
          if (!node.children.has(seg)) node.children.set(seg, { path: acc, name: seg, children: new Map(), files: new Set(), last: 0, real: false });
          node = node.children.get(seg);
          const d = data.get(t);
          if (d) d.files.forEach((f) => node.files.add(f));
          node.last = Math.max(node.last, lastOf(t));
          if (i === arr.length - 1) node.real = true;
        });
      });
      const keep = (n) => matchTag(n.path) || [...n.children.values()].some(keep);
      const out = [];
      const visit = (n, d) => {
        [...n.children.values()].filter((k) => !q || keep(k)).sort(cmp).forEach((k) => {
          const hasKids = k.children.size > 0;
          const open = q ? true : this.isOpen(k.path, false);
          out.push({ type: 'tag', path: k.path, label: k.name, depth: d, count: k.files.size, last: k.last, hasKids, open, real: k.real });
          if (hasKids) this.containers.push(k.path);
          if (hasKids && open) visit(k, d + 1);
        });
      };
      visit(root, depth);
      return out;
    };
    const make = (tags, depth) => (c.nested ? nestedRows(tags, depth) : flat(tags, depth));
    const folderOf = new Map();
    (s.tagFolders || []).forEach((f) => (f.tags || []).forEach((t) => folderOf.set(t, f.id)));
    const all = [...data.keys()];
    const rows = [];
    (s.tagFolders || []).forEach((f) => {
      const ft = all.filter((t) => folderOf.get(t) === f.id);
      const open = q ? true : this.isOpen('folder:' + f.id, true);
      const inner = make(ft, 1);
      if (q && !inner.length && !f.name.toLowerCase().includes(q)) return;
      rows.push({ type: 'folder', id: f.id, path: 'folder:' + f.id, label: f.name, depth: 0, count: ft.length, open });
      this.containers.push('folder:' + f.id);
      if (open) rows.push(...inner);
    });
    rows.push(...make(all.filter((t) => !folderOf.has(t)), 0));
    return rows;
  }

  renderBody() {
    const body = this.bodyEl, s = this.s;
    body.empty();
    body.style.minWidth = this.totalWidth() + 'px';
    this.rows = this.buildModel();
    const meta = s.tagMeta || {};
    let n = 0;
    this.rows.forEach((r) => {
      const row = body.createDiv({ cls: 'ffm-panel-row' });
      row.style.gridTemplateColumns = this.tpl();
      row.dataset.key = r.path;
      row.draggable = true;
      if (this.sel.has(r.path)) row.addClass('is-selected');
      const md = meta[r.path] || {};
      if (r.type === 'tag') n++;
      row.createDiv({ cls: 'ffm-cell ffm-num-cell', text: r.type === 'tag' ? pad3(n) : '' });
      const st = row.createDiv({ cls: 'ffm-cell ffm-state-cell' });
      if (r.type === 'tag') {
        const lock = st.createSpan({ cls: 'ffm-lock' });
        setIcon(lock, md.locked ? 'lock' : 'lock-open');
        lock.toggleClass('is-locked', !!md.locked);
        lock.setAttr('aria-label', md.locked ? _t("Locked (cannot be renamed, deleted or merged)") : _t("Click to lock"));
        lock.addEventListener('click', (e) => { e.stopPropagation(); this.plugin.toggleTagLock([r.path]); });
      }
      const nm = row.createDiv({ cls: 'ffm-cell ffm-name-cell' });
      nm.style.paddingLeft = r.depth * 14 + 'px'; nm.dataset.depth = String(r.depth);
      const arrow = nm.createSpan({ cls: 'ffm-arrow' });
      if (r.type === 'folder' || r.hasKids) {
        setIcon(arrow, r.open ? 'chevron-down' : 'chevron-right');
        arrow.addEventListener('click', (e) => { e.stopPropagation(); if (!s.tagExpanded) s.tagExpanded = {}; s.tagExpanded[r.path] = !r.open; this.plugin.saveSoon(); this.renderBody(); });
      }
      if (r.type === 'folder') setIcon(nm.createSpan({ cls: 'ffm-icon' }), r.open ? 'folder-open' : 'folder');
      nm.createSpan({ cls: 'ffm-name-text ffm-cell-text', text: r.type === 'tag' ? '#' + r.label : r.label });
      const nt = row.createDiv({ cls: 'ffm-cell ffm-note-cell' });
      nt.createSpan({ cls: 'ffm-cell-text', text: r.type === 'tag' ? md.note || '' : '' });
      if (r.type === 'tag') {
        nt.setAttr('aria-label', _t("Click to edit the note"));
        nt.addEventListener('click', (e) => { e.stopPropagation(); this.editNote(r, nt); });
      }
      row.createDiv({ cls: 'ffm-cell ffm-last-cell', text: r.type === 'tag' ? fmtAgo(r.last) : '' });
      row.createDiv({ cls: 'ffm-cell ffm-count-cell', text: String(r.count) });

      row.addEventListener('click', (e) => this.onRowClick(e, r));
      row.addEventListener('dblclick', (e) => { e.preventDefault(); if (e.target.closest && (e.target.closest('.ffm-lock') || e.target.closest('.ffm-note-cell') || e.target.closest('.ffm-arrow'))) return; this.startRename(r, row); });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!this.sel.has(r.path)) { this.sel = new Set([r.path]); this.lastClicked = r.path; this.updateSel(); }
        this.showMenu(e, r);
      });
      row.addEventListener('dragstart', (e) => {
        if (!this.sel.has(r.path)) { this.sel = new Set([r.path]); this.updateSel(); }
        this.dragKeys = [...this.sel];
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', this.dragKeys.join('\n')); }
      });
      row.addEventListener('dragend', () => { this.dragKeys = null; this.clearMarks(); });
      row.addEventListener('dragover', (e) => {
        if (!this.dragKeys) return;
        e.preventDefault();
        this.clearMarks();
        row.addClass('drop-' + this.dropPos(e, row, r));
      });
      row.addEventListener('drop', (e) => {
        if (!this.dragKeys) return;
        e.preventDefault();
        const pos = this.dropPos(e, row, r), keys = this.dragKeys;
        this.dragKeys = null; this.clearMarks();
        this.onDrop(keys, r, pos);
      });
    });
    if (!this.rows.length) body.createDiv({ cls: 'ffm-empty', text: _t("(No tags)") });
  }
  dropPos(e, row, r) {
    const rect = row.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (r.type === 'folder' && y > 0.25 && y < 0.75) return 'inside';
    return y < 0.5 ? 'above' : 'below';
  }
  clearMarks() { this.bodyEl.querySelectorAll('.ffm-panel-row').forEach((x) => x.removeClasses(['drop-above', 'drop-below', 'drop-inside'])); }
  onDrop(keys, target, pos) {
    const p = this.plugin;
    const tags = keys.filter((k) => !k.startsWith('folder:'));
    if (!tags.length) return;
    if (target.type === 'folder' && pos === 'inside') { p.tagToFolder(tags, target.id); return; }
    p.tagReorder(this, tags, target.path, pos === 'above' ? 'before' : 'after');
  }
  updateSel() { this.bodyEl.querySelectorAll('.ffm-panel-row').forEach((r) => r.toggleClass('is-selected', this.sel.has(r.dataset.key))); }
  onRowClick(e, r) {
    if (e.target.closest && (e.target.closest('.ffm-lock') || e.target.closest('.ffm-arrow') || e.target.closest('.ffm-note-cell'))) return;
    const key = r.path;
    if (e.shiftKey && this.lastClicked) {
      const keys = this.rows.map((x) => x.path);
      const a = keys.indexOf(this.lastClicked), b = keys.indexOf(key);
      if (a >= 0 && b >= 0) this.sel = new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (e.ctrlKey || e.metaKey || this.selectMode) {
      if (this.sel.has(key)) this.sel.delete(key); else this.sel.add(key);
      this.lastClicked = key;
      if (this.selectMode && !this.sel.size) this.selectMode = false;
    } else { this.sel = new Set([key]); this.lastClicked = key; }
    this.updateSel();
  }
  selTags() { return [...this.sel].filter((k) => !k.startsWith('folder:')); }
  selectAll() { this.sel = new Set(this.rows.map((r) => r.path)); this.updateSel(); }

  startRename(r, row) {
    if (r.type === 'folder') {
      new TextPromptModal(this.plugin.app, _t("Rename folder"), r.label, (name) => this.plugin.renameTagFolder(r.id, name)).open();
      return;
    }
    const cell = row.querySelector('.ffm-name-text');
    if (!cell) return;
    const input = createEl('input', { cls: 'ffm-rename', type: 'text' });
    input.value = r.path;
    cell.replaceWith(input);
    input.focus(); if (input.select) input.select();
    let done = false;
    const finish = async (ok) => {
      if (done) return; done = true;
      const v = input.value.trim().replace(/^#/, '');
      if (ok && v && v !== r.path) await this.plugin.renameTag(r.path, v);
      this.renderBody();
    };
    ['click', 'dblclick', 'mousedown'].forEach((n) => input.addEventListener(n, (e) => e.stopPropagation()));
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }
  editNote(r, cell) {
    const md = (this.s.tagMeta || {})[r.path] || {};
    cell.empty();
    const input = cell.createEl('input', { type: 'text', cls: 'ffm-rename' });
    input.value = md.note || '';
    input.focus();
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      if (ok) this.plugin.setTagNote(r.path, input.value.trim());
      this.renderBody();
    };
    ['click', 'mousedown', 'dblclick'].forEach((n) => input.addEventListener(n, (e) => e.stopPropagation()));
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }

  onKey(e) {
    const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
    if (mod && k === 'c') { e.preventDefault(); this.copy(e.shiftKey); }
    else if (mod && k === 'a') { e.preventDefault(); this.selectAll(); }
    else if (k === 'f2') { const r = this.rows.find((x) => this.sel.has(x.path)); if (r) this.startRename(r, this.bodyEl.querySelector('.ffm-panel-row.is-selected') || this.bodyEl); }
    else if (k === 'escape' && this.selectMode) { this.selectMode = false; this.sel = new Set(); this.updateSel(); }
  }
  async copy(withHash) {
    const tags = this.selTags();
    if (!tags.length) return;
    try { await navigator.clipboard.writeText(tags.map((t) => (withHash ? '#' + t : t)).join('\n')); new Notice(_t("Copied {0} tags", tags.length)); }
    catch (e) { new Notice(_t("Copy failed")); }
  }

  showMenu(e, r) {
    const p = this.plugin, m = new Menu();
    const tags = this.selTags();
    const add = (title, icon, fn) => m.addItem((i) => i.setTitle(title).setIcon(icon).onClick(fn));
    add(_t("Create tag"), 'tag', () => p.promptNewTag());
    m.addSeparator();
    if (tags.length) {
      add(_t("Search (include)"), 'search', () => p.searchTags(tags.map((t) => ({ tag: t, neg: false }))));
      add(_t("Search (exclude)"), 'search-x', () => p.searchTags(tags.map((t) => ({ tag: t, neg: true }))));
      add(_t("Add search condition (include)"), 'plus-circle', () => p.addTagTerms(tags, false));
      add(_t("Add search condition (exclude)"), 'minus-circle', () => p.addTagTerms(tags, true));
    }
    if (p.tagTerms.length) {
      add(_t("Run search ({0} conditions)", p.tagTerms.length), 'play', () => p.searchTags(p.tagTerms));
      add(_t("Clear search conditions"), 'eraser', () => { p.tagTerms = []; new Notice(_t("Search conditions cleared")); });
    }
    m.addSeparator();
    if (tags.length) {
      add(_t("Copy tag names"), 'copy', () => this.copy(false));
      add(_t("Copy tag names with #"), 'hash', () => this.copy(true));
      m.addSeparator();
    }
    if (r && r.type === 'tag' && tags.length <= 1) add(_t("Rename"), 'pencil', () => this.startRename(r, this.bodyEl.querySelector(`[data-key="${r.path}"]`) || this.bodyEl));
    if (this.selectMode) add(_t("Exit selection mode"), 'x', () => { this.selectMode = false; this.sel = new Set(); this.updateSel(); });
    else add(_t("Enter selection mode"), 'check-square', () => { this.selectMode = true; this.updateSel(); });
    add(_t("Select all"), 'check-check', () => this.selectAll());
    if (tags.length) {
      m.addSeparator();
      add(_t("Merge tags…"), 'merge', () => new MergeTagsModal(p.app, p, tags).open());
      add(_t("Delete tags…"), 'trash', () => new DeleteTagsModal(p.app, p, tags).open());
      add(_t("Lock / unlock"), 'lock', () => p.toggleTagLock(tags));
      add(tags.every((x) => (this.s.tagFilesOpen || {})[x]) ? _t("Hide files using this tag") : _t("Show files using this tag"), 'files', () => p.toggleTagFiles(tags));
    }
    m.addSeparator();
    add(_t("Create folder"), 'folder-plus', () => p.promptNewTagFolder(tags));
    if (tags.length && (this.s.tagFolders || []).length) {
      add(_t("Add to folder…"), 'folder-input', () => {
        const fm = new Menu();
        this.s.tagFolders.forEach((f) => fm.addItem((i) => i.setTitle(f.name).setIcon('folder').onClick(() => p.tagToFolder(tags, f.id))));
        fm.showAtMouseEvent(e);
      });
      add(_t("Move out of folder"), 'folder-output', () => p.tagToFolder(tags, null));
    }
    if (r && r.type === 'folder') add(_t("Delete folder (tags are kept)"), 'folder-x', () => p.deleteTagFolder(r.id));
    if (tags.length) {
      m.addSeparator();
      add(_t("Move up"), 'arrow-up', () => p.tagMove(this, tags, -1));
      add(_t("Move down"), 'arrow-down', () => p.tagMove(this, tags, 1));
      add(_t("Move up one level"), 'corner-left-up', () => p.tagOutdent(tags));
      add(_t("Move down one level"), 'corner-right-down', () => p.tagIndent(this, tags));
    }
    if (panelColKey(e)) { m.addSeparator(); add(_t("Column format…"), 'columns', () => panelColMenu(this, e, panelColKey(e))); }
    m.showAtMouseEvent(e);
  }
}

class MergeTagsModal extends Modal {
  constructor(app, plugin, tags) { super(app); this.plugin = plugin; this.tags = tags; }
  onOpen() {
    const p = this.plugin, el = this.contentEl;
    this.titleEl.setText(_t("Merge tags ({0})", this.tags.length));
    const st = { target: this.tags[0], mode: 'replace' };
    const data = p.tagData();
    el.createEl('p', { cls: 'setting-item-description', text: _t("Tags to merge: {0}", this.tags.map((t) => '#' + t).join(', ')) });
    new Setting(el).setName(_t("Resulting tag name")).setDesc(_t("Enter an existing tag name = merge into that tag; enter a new name = rename, then merge"))
      .addText((t2) => {
        t2.setValue(st.target).onChange((v) => (st.target = v.trim().replace(/^#/, '')));
        attachSuggest(t2.inputEl, (txt) => [...data.keys()].filter((x) => !this.tags.includes(x) && (!txt || x.toLowerCase().includes(String(txt).toLowerCase().replace(/^#/, '')))).slice(0, 12), (c) => { st.target = c; t2.setValue(c); });
      });
    new Setting(el).setName(_t("Merged tags in notes")).addDropdown((d) => {
      d.addOption('replace', _t("Replace with the new tag name")); d.addOption('remove', _t("Delete everything")); d.addOption('unhash', _t("Delete only the # (keep the text)"));
      d.setValue(st.mode); d.onChange((v) => (st.mode = v));
    });
    new Setting(el)
      .addButton((b) => b.setButtonText(_t("Cancel")).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(_t("Merge")).setCta().onClick(async () => {
        if (st.mode === 'replace' && !st.target) { new Notice(_t("Please enter the resulting tag name")); return; }
        this.close();
        await p.mergeTags(this.tags, st.target, st.mode);
      }));
  }
  onClose() { this.contentEl.empty(); }
}

class DeleteTagsModal extends Modal {
  constructor(app, plugin, tags) { super(app); this.plugin = plugin; this.tags = tags; }
  onOpen() {
    const p = this.plugin, el = this.contentEl;
    this.titleEl.setText(_t("Delete tags ({0})", this.tags.length));
    const st = { mode: 'all' };
    const data = p.tagData();
    const files = new Set();
    this.tags.forEach((t) => data.forEach((d, k) => { if (k === t || k.startsWith(t + '/')) d.files.forEach((f) => files.add(f)); }));
    el.createEl('p', { cls: 'setting-item-description', text: _t("This will affect {0} notes: {1}", files.size, this.tags.map((t) => '#' + t).join(', ')) });
    new Setting(el).setName(_t("Tags in notes")).addDropdown((d) => {
      d.addOption('all', _t("Delete everything")); d.addOption('hash', _t("Delete only the # (keep the text)"));
      d.setValue(st.mode); d.onChange((v) => (st.mode = v));
    });
    new Setting(el)
      .addButton((b) => b.setButtonText(_t("Cancel")).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(_t("Delete")).setWarning().onClick(async () => { this.close(); await p.deleteTags(this.tags, st.mode); }));
  }
  onClose() { this.contentEl.empty(); }
}

class DedupeTagsModal extends Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; }
  onOpen() {
    const p = this.plugin, s = p.settings, el = this.contentEl;
    this.modalEl.addClass('ffm-icon-modal');
    this.titleEl.setText(_t("Remove duplicate tags"));
    el.createEl('p', { cls: 'setting-item-description', text: _t("Finds tags with similar names. For each group, choose the tag to keep, then merge or delete the others.") });
    this.listEl = el.createDiv({ cls: 'ffm-dedupe-list' });
    new Setting(el).setName(_t("Similarity threshold (%)")).setDesc(_t("A higher value lists only closer matches"))
      .addSlider((sl) => sl.setLimits(50, 100, 1).setValue(Number(s.tagDupThreshold) || 80).setDynamicTooltip().onChange(async (v) => { s.tagDupThreshold = v; p.saveSoon(); this.renderList(); }));
    this.renderList();
  }
  renderList() {
    const p = this.plugin, el = this.listEl, data = p.tagData();
    el.empty();
    const groups = findSimilarGroups(data.keys(), (Number(p.settings.tagDupThreshold) || 80) / 100);
    if (!groups.length) { el.createDiv({ cls: 'ffm-empty', text: _t("No similar tags found") }); return; }
    groups.forEach((g, gi) => {
      const card = el.createDiv({ cls: 'ffm-dedupe-card' });
      let keep = [...g].sort((a, b) => data.get(b).count - data.get(a).count)[0];
      const checked = new Set(g.filter((t) => t !== keep));
      const rows = card.createDiv();
      const draw = () => {
        rows.empty();
        g.forEach((t) => {
          const row = rows.createDiv({ cls: 'ffm-dedupe-row' });
          const radio = row.createEl('input', { type: 'radio' });
          radio.name = 'keep' + gi; radio.checked = t === keep;
          radio.onchange = () => { keep = t; checked.delete(t); draw(); };
          const cb = row.createEl('input', { type: 'checkbox' });
          cb.checked = checked.has(t); cb.disabled = t === keep;
          cb.onchange = () => { if (cb.checked) checked.add(t); else checked.delete(t); };
          row.createSpan({ cls: 'ffm-dedupe-name', text: `#${t}` });
          row.createSpan({ cls: 'ffm-dedupe-count', text: `${data.get(t).count}` });
        });
      };
      draw();
      const bar = card.createDiv({ cls: 'ffm-yaml-chip-row' });
      const merge = bar.createEl('button', { cls: 'ffm-btn', text: _t("Merge (keep the selected one)") });
      merge.onclick = async () => { const src = [...checked].filter((t) => t !== keep); if (!src.length) return; await p.mergeTags(src, keep, 'replace'); this.renderList(); };
      const del = bar.createEl('button', { cls: 'ffm-btn', text: _t("Delete (the checked tags)") });
      del.onclick = async () => { const src = [...checked].filter((t) => t !== keep); if (!src.length) return; await p.deleteTags(src, 'all'); this.renderList(); };
    });
  }
  onClose() { this.contentEl.empty(); }
}

/* ------------------------------ 屬性管理面板 ------------------------------ */
class PropPanel {
  constructor(plugin, host) {
    this.plugin = plugin; this.host = host;
    this.sel = new Set(); this.selectMode = false; this.searchOn = false; this.query = '';
    this.rows = []; this.containers = []; this.lastClicked = null; this.dragKeys = null; this.expandNext = 'expand';
  }
  get s() { return this.plugin.settings; }
  cfg() { const s = this.s; if (!s.propPanel) s.propPanel = {}; if (!s.propPanel.sort) s.propPanel.sort = 'name-asc'; return s.propPanel; }
  cols() { return Object.assign({ num: 56, type: 60, name: 260, count: 70 }, this.s[this.colsField()] || {}); }
  tpl() { const c = this.cols(); return `${c.num}px ${c.type}px ${c.name}px ${c.count}px`; }
  totalWidth() { const c = this.cols(); return c.num + c.type + c.name + c.count; }
  isOpen(key, def) { const v = (this.s.propExpanded || {})[key]; return v === undefined ? def : v; }
  sortName(k) { return k === 'name-desc' ? _t("Property name Z → A") : k === 'manual' ? _t("Manual order") : _t("Property name A → Z"); }
  isList(t) { return t === 'multitext' || t === 'tags' || t === 'aliases'; }

  render() {
    const host = this.host;
    const keep = this.scroller ? this.scroller.scrollTop : 0;
    host.empty();
    host.addClass('ffm-panel');
    const bar = host.createDiv({ cls: 'ffm-panel-bar' });
    const p = this.plugin, c = this.cfg();
    panelBtn(p, bar, { icon: 'arrow-up-down', label: _t("Sort: {0}", this.sortName(c.sort)), tip: _t("Sort order"), onclick: (e) => this.sortMenu(e) });
    const collapse = this.expandNext === 'collapse';
    panelBtn(p, bar, { icon: collapse ? 'chevrons-down-up|chevron-up' : 'chevrons-up-down|chevron-down', label: collapse ? _t("Collapse all") : _t("Expand all"), tip: collapse ? _t("Collapse all") : _t("Expand all"), onclick: () => this.toggleAll() });
    panelBtn(p, bar, { icon: 'search', label: _t("Search"), tip: _t("Search properties"), on: this.searchOn, onclick: () => { this.searchOn = !this.searchOn; if (!this.searchOn) this.query = ''; this.render(); } });
    if (!this.standalone) panelBtn(p, bar, { icon: 'plus', label: '＋', tip: _t("Open in a tab"), onclick: () => p.openManagerTab('props') }).addClass('ffm-push-right');
    this.searchWrap = host.createDiv({ cls: 'ffm-panel-search' });
    this.searchWrap.style.display = this.searchOn ? '' : 'none';
    if (this.searchOn) {
      const input = this.searchWrap.createEl('input', { type: 'search', cls: 'ffm-panel-search-input' });
      input.placeholder = _t("Search properties…"); input.value = this.query;
      input.addEventListener('input', () => { this.query = input.value; this.renderBody(); });
      setTimeout(() => { if (input.focus) input.focus(); }, 0);
    }
    this.scroller = host.createDiv({ cls: 'ffm-panel-scroll' });
    this.headEl = this.scroller.createDiv({ cls: 'ffm-panel-head' });
    this.bodyEl = this.scroller.createDiv({ cls: 'ffm-panel-body' });
    this.scroller.tabIndex = 0;
    this.scroller.addEventListener('keydown', (e) => this.onKey(e));
    this.bodyEl.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showMenu(e, null); });
    this.renderHead(); this.renderBody();
    this.scroller.scrollTop = keep;
  }
  sortMenu(e) {
    const c = this.cfg(), m = new Menu();
    ['name-asc', 'name-desc', 'manual'].forEach((k) => m.addItem((i) => i.setTitle(this.sortName(k)).setChecked(c.sort === k).onClick(() => { c.sort = k; this.plugin.saveSoon(); this.render(); })));
    m.showAtMouseEvent(e);
  }
  toggleAll() {
    const s = this.s;
    if (!s.propExpanded) s.propExpanded = {};
    const open = this.expandNext !== 'collapse';
    this.containers.forEach((k) => { s.propExpanded[k] = open; });
    this.expandNext = open ? 'collapse' : 'expand';
    this.plugin.saveSoon();
    this.render();
  }
  renderHead() {
    const head = this.headEl, c = this.cols();
    head.empty();
    head.style.gridTemplateColumns = this.tpl(); head.style.minWidth = this.totalWidth() + 'px';
    [['num', _t("No.")], ['type', _t("Property type")], ['name', _t("Property name")], ['count', _t("Count")]].forEach(([k, label]) => {
      const cell = head.createDiv({ cls: 'ffm-panel-hcell' });
      cell.createSpan({ cls: 'ffm-cell-text', text: label });
      const grip = cell.createDiv({ cls: 'ffm-col-grip' });
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const startX = e.clientX, startW = c[k];
        grip.setPointerCapture(e.pointerId);
        const move = (ev) => {
          c[k] = Math.max(32, Math.round(startW + ev.clientX - startX)); this.s[this.colsField()] = Object.assign({}, c);
          const tpl = this.tpl(), w = this.totalWidth() + 'px';
          head.style.gridTemplateColumns = tpl; head.style.minWidth = w; this.bodyEl.style.minWidth = w;
          this.bodyEl.querySelectorAll('.ffm-panel-row').forEach((r) => { r.style.gridTemplateColumns = tpl; });
        };
        const up = (ev) => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); try { grip.releasePointerCapture(ev.pointerId); } catch (err) { /* ignore */ } this.plugin.saveSoon(); };
        grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
      });
    });
  }

  buildModel() {
    const p = this.plugin, s = this.s, c = this.cfg();
    const data = p.propData();
    const q = this.query.trim().toLowerCase();
    const order = new Map((s.propOrder || []).map((t, i) => [t, i]));
    const cmp = (a, b) => {
      if (c.sort === 'name-desc') return yamlCmp(b.name, a.name);
      if (c.sort === 'manual') return ((order.has(a.name) ? order.get(a.name) : 1e9) - (order.has(b.name) ? order.get(b.name) : 1e9)) || yamlCmp(a.name, b.name);
      return yamlCmp(a.name, b.name);
    };
    this.containers = [];
    const rowsFor = (names, depth) => {
      const out = [];
      names.map((n) => data.get(n)).filter(Boolean).sort(cmp).forEach((pr) => {
        const list = this.isList(pr.type);
        const vals = list ? p.propValues(pr.name) : [];
        const shownVals = q ? vals.filter(([v]) => String(v).toLowerCase().includes(q)) : vals;
        const nameHit = !q || pr.name.toLowerCase().includes(q);
        if (!nameHit && !shownVals.length) return;
        const open = q ? true : this.isOpen(pr.name, false);
        out.push({ type: 'prop', path: pr.name, label: pr.name, ptype: pr.type, depth, count: pr.count, hasKids: list && vals.length > 0, open });
        if (list && vals.length) this.containers.push(pr.name);
        if (list && open) (nameHit && !q ? vals : shownVals).forEach(([v, n]) => out.push({ type: 'value', path: `val:${pr.name}\u0000${v}`, prop: pr.name, label: String(v), depth: depth + 1, count: n }));
      });
      return out;
    };
    const folderOf = new Map();
    (s.propFolders || []).forEach((f) => (f.props || []).forEach((n) => folderOf.set(n, f.id || f.name)));
    const all = [...data.keys()];
    const rows = [];
    (s.propFolders || []).forEach((f) => {
      const id = f.id || f.name;
      const names = all.filter((n) => folderOf.get(n) === id);
      const open = q ? true : this.isOpen('pfolder:' + id, true);
      const inner = rowsFor(names, 1);
      if (q && !inner.length && !f.name.toLowerCase().includes(q)) return;
      rows.push({ type: 'folder', id, path: 'pfolder:' + id, label: f.name, depth: 0, count: names.length, open });
      this.containers.push('pfolder:' + id);
      if (open) rows.push(...inner);
    });
    rows.push(...rowsFor(all.filter((n) => !folderOf.has(n)), 0));
    return rows;
  }
  renderBody() {
    const body = this.bodyEl, s = this.s;
    body.empty();
    body.style.minWidth = this.totalWidth() + 'px';
    this.rows = this.buildModel();
    let n = 0;
    this.rows.forEach((r) => {
      const row = body.createDiv({ cls: 'ffm-panel-row' });
      row.style.gridTemplateColumns = this.tpl();
      row.dataset.key = r.path;
      row.draggable = r.type === 'prop';
      if (this.sel.has(r.path)) row.addClass('is-selected');
      if (r.type === 'prop') n++;
      row.createDiv({ cls: 'ffm-cell ffm-num-cell', text: r.type === 'prop' ? pad3(n) : '' });
      const ty = row.createDiv({ cls: 'ffm-cell ffm-state-cell' });
      if (r.type === 'prop') { const ic = ty.createSpan({ cls: 'ffm-ptype' }); setIcon(ic, pickIcon(propTypeIcon(r.ptype))); ic.setAttr('aria-label', propTypeLabel(r.ptype)); }
      const nm = row.createDiv({ cls: 'ffm-cell ffm-name-cell' });
      nm.style.paddingLeft = r.depth * 14 + 'px'; nm.dataset.depth = String(r.depth);
      const arrow = nm.createSpan({ cls: 'ffm-arrow' });
      if (r.type === 'folder' || (r.type === 'prop' && r.hasKids)) {
        setIcon(arrow, r.open ? 'chevron-down' : 'chevron-right');
        arrow.addEventListener('click', (e) => { e.stopPropagation(); if (!s.propExpanded) s.propExpanded = {}; s.propExpanded[r.type === 'folder' ? r.path : r.path] = !r.open; this.plugin.saveSoon(); this.renderBody(); });
      }
      if (r.type === 'folder') setIcon(nm.createSpan({ cls: 'ffm-icon' }), r.open ? 'folder-open' : 'folder');
      nm.createSpan({ cls: 'ffm-name-text ffm-cell-text' + (r.type === 'value' ? ' is-value' : ''), text: r.label });
      row.createDiv({ cls: 'ffm-cell ffm-count-cell', text: String(r.count) });

      row.addEventListener('click', (e) => this.onRowClick(e, r));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!this.sel.has(r.path)) { this.sel = new Set([r.path]); this.lastClicked = r.path; this.updateSel(); }
        this.showMenu(e, r);
      });
      row.addEventListener('dragstart', (e) => {
        if (r.type !== 'prop') return;
        if (!this.sel.has(r.path)) { this.sel = new Set([r.path]); this.updateSel(); }
        this.dragKeys = this.selProps();
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', this.dragKeys.join('\n')); }
      });
      row.addEventListener('dragend', () => { this.dragKeys = null; this.clearMarks(); });
      row.addEventListener('dragover', (e) => {
        if (!this.dragKeys) return;
        e.preventDefault(); this.clearMarks();
        const rect = row.getBoundingClientRect(), y = (e.clientY - rect.top) / rect.height;
        row.addClass(r.type === 'folder' && y > 0.25 && y < 0.75 ? 'drop-inside' : y < 0.5 ? 'drop-above' : 'drop-below');
      });
      row.addEventListener('drop', (e) => {
        if (!this.dragKeys) return;
        e.preventDefault();
        const rect = row.getBoundingClientRect(), y = (e.clientY - rect.top) / rect.height;
        const keys = this.dragKeys; this.dragKeys = null; this.clearMarks();
        if (r.type === 'folder' && y > 0.25 && y < 0.75) this.plugin.propToFolder(keys, r.id);
        else if (r.type === 'prop') this.plugin.propReorder(this, keys, r.path, y < 0.5 ? 'before' : 'after');
      });
    });
    if (!this.rows.length) body.createDiv({ cls: 'ffm-empty', text: _t("(No properties)") });
  }
  clearMarks() { this.bodyEl.querySelectorAll('.ffm-panel-row').forEach((x) => x.removeClasses(['drop-above', 'drop-below', 'drop-inside'])); }
  updateSel() { this.bodyEl.querySelectorAll('.ffm-panel-row').forEach((r) => r.toggleClass('is-selected', this.sel.has(r.dataset.key))); }
  onRowClick(e, r) {
    if (e.target.closest && e.target.closest('.ffm-arrow')) return;
    const key = r.path;
    if (e.shiftKey && this.lastClicked) {
      const keys = this.rows.map((x) => x.path);
      const a = keys.indexOf(this.lastClicked), b = keys.indexOf(key);
      if (a >= 0 && b >= 0) this.sel = new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (e.ctrlKey || e.metaKey || this.selectMode) {
      if (this.sel.has(key)) this.sel.delete(key); else this.sel.add(key);
      this.lastClicked = key;
      if (this.selectMode && !this.sel.size) this.selectMode = false;
    } else { this.sel = new Set([key]); this.lastClicked = key; }
    this.updateSel();
  }
  selProps() { return this.rows.filter((r) => r.type === 'prop' && this.sel.has(r.path)).map((r) => r.path); }
  selValues() { return this.rows.filter((r) => r.type === 'value' && this.sel.has(r.path)); }
  selectAll() { this.sel = new Set(this.rows.filter((r) => r.type !== 'folder').map((r) => r.path)); this.updateSel(); }
  onKey(e) {
    const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
    if (mod && k === 'c') { e.preventDefault(); this.copy('name'); }
    else if (mod && k === 'a') { e.preventDefault(); this.selectAll(); }
    else if (k === 'escape' && this.selectMode) { this.selectMode = false; this.sel = new Set(); this.updateSel(); }
  }
  async copy(kind) {
    const props = this.selProps();
    if (!props.length) return;
    const data = this.plugin.propData();
    let text;
    if (kind === 'name') text = props.join('\n');
    else if (kind === 'typeName') text = props.map((n) => `${propTypeLabel((data.get(n) || {}).type)}: ${n}`).join('\n');
    else text = props.map((n) => { const vals = this.plugin.propValues(n).map(([v]) => v); return vals.length ? `${n}: ${vals.join(', ')}` : `${n}:`; }).join('\n');
    try { await navigator.clipboard.writeText(text); new Notice(_t("Copied {0} properties", props.length)); } catch (e) { new Notice(_t("Copy failed")); }
  }

  showMenu(e, r) {
    const p = this.plugin, m = new Menu();
    const props = this.selProps(), vals = this.selValues();
    const data = p.propData();
    const add = (title, icon, fn) => m.addItem((i) => i.setTitle(title).setIcon(icon).onClick(fn));
    if (r && r.type === 'value') {
      add(_t("Rename value"), 'pencil', () => new TextPromptModal(p.app, _t("Rename value"), r.label, (v) => p.renamePropValue(r.prop, r.label, v)).open());
      add(_t("Delete value"), 'trash', () => new ConfirmModal(p.app, _t("Delete the value \"{1}\" from property {0} in all notes?", r.prop, r.label), () => p.deletePropValue(r.prop, r.label)).open());
      m.addSeparator();
    }
    if (props.length) {
      add(_t("Property type"), 'shapes', () => {
        const tm = new Menu();
        PROP_TYPES.forEach(([id, label, icon]) => tm.addItem((i) => i.setTitle(_t(label)).setIcon(pickIcon(icon)).onClick(() => p.setPropType(props, id))));
        tm.showAtMouseEvent(e);
      });
      add(_t("Rename"), 'pencil', () => new RenamePropsModal(p.app, p, props).open());
      add(_t("Delete property"), 'trash', () => new ConfirmModal(p.app, _t("Delete these {0} properties? They will be removed from all notes.", props.length), () => p.deleteProps(props)).open());
      m.addSeparator();
    }
    if (this.selectMode) add(_t("Exit selection mode"), 'x', () => { this.selectMode = false; this.sel = new Set(); this.updateSel(); });
    else add(_t("Enter selection mode"), 'check-square', () => { this.selectMode = true; this.updateSel(); });
    add(_t("Select all"), 'check-check', () => this.selectAll());
    if (props.length) {
      m.addSeparator();
      add(_t("Copy property names"), 'copy', () => this.copy('name'));
      add(_t("Copy property type + name"), 'copy', () => this.copy('typeName'));
      add(_t("Copy properties (with values)"), 'copy', () => this.copy('values'));
      if (props.every((n) => this.isList((data.get(n) || {}).type))) add(_t("Add values…"), 'plus-circle', () => new AddPropValuesModal(p.app, p, props).open());
      add(_t("Search"), 'search', () => p.searchProps(props));
    }
    m.addSeparator();
    add(_t("Create property"), 'plus', () => new CreatePropModal(p.app, p).open());
    add(_t("Create folder"), 'folder-plus', () => p.promptNewPropFolder(props));
    if (props.length && (this.s.propFolders || []).length) {
      add(_t("Add to folder…"), 'folder-input', () => {
        const fm = new Menu();
        this.s.propFolders.forEach((f) => fm.addItem((i) => i.setTitle(f.name).setIcon('folder').onClick(() => p.propToFolder(props, f.id || f.name))));
        fm.showAtMouseEvent(e);
      });
      add(_t("Move out of folder"), 'folder-output', () => p.propToFolder(props, null));
    }
    if (r && r.type === 'folder') add(_t("Delete folder (properties are kept)"), 'folder-x', () => p.deletePropFolder(r.id));
    if (props.length) {
      m.addSeparator();
      add(_t("Move up"), 'arrow-up', () => p.propMove(this, props, -1));
      add(_t("Move down"), 'arrow-down', () => p.propMove(this, props, 1));
      add(_t("Move up one level"), 'corner-left-up', () => p.propToFolder(props, null));
      add(_t("Move down one level"), 'corner-right-down', () => p.propIndent(this, props));
    }
    if (panelColKey(e)) { m.addSeparator(); add(_t("Column format…"), 'columns', () => panelColMenu(this, e, panelColKey(e))); }
    m.showAtMouseEvent(e);
  }
}

class RenamePropsModal extends Modal {
  constructor(app, plugin, names) { super(app); this.plugin = plugin; this.names = names; }
  onOpen() {
    const p = this.plugin, el = this.contentEl;
    this.titleEl.setText(_t("Rename properties ({0})", this.names.length));
    const map = {};
    this.names.forEach((n) => { map[n] = n; new Setting(el).setName(n).addText((t2) => t2.setValue(n).onChange((v) => (map[n] = v.trim()))); });
    new Setting(el)
      .addButton((b) => b.setButtonText(_t("Cancel")).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(_t("Apply")).setCta().onClick(async () => {
        const changes = Object.entries(map).filter(([o, n]) => n && n !== o);
        this.close();
        if (changes.length) await p.renameProps(Object.fromEntries(changes));
      }));
  }
  onClose() { this.contentEl.empty(); }
}
class CreatePropModal extends Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; }
  onOpen() {
    const p = this.plugin, el = this.contentEl, st = { name: '', type: 'text' };
    this.titleEl.setText(_t("Create property"));
    new Setting(el).setName(_t("Property name")).addText((t2) => t2.onChange((v) => (st.name = v.trim())));
    new Setting(el).setName(_t("Property type")).addDropdown((d) => { PROP_TYPES.forEach(([id, label]) => d.addOption(id, _t(label))); d.setValue(st.type); d.onChange((v) => (st.type = v)); });
    new Setting(el).addButton((b) => b.setButtonText(_t("Cancel")).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(_t("Create")).setCta().onClick(async () => { if (!st.name) { new Notice(_t("Please enter a property name first")); return; } this.close(); await p.createProp(st.name, st.type); }));
  }
  onClose() { this.contentEl.empty(); }
}
class AddPropValuesModal extends Modal {
  constructor(app, plugin, props) { super(app); this.plugin = plugin; this.props = props; }
  onOpen() {
    const p = this.plugin, el = this.contentEl, st = { text: '' };
    this.titleEl.setText(_t("Add values ({0} properties)", this.props.length));
    el.createEl('p', { cls: 'setting-item-description', text: _t("These values are added to every note that uses these properties (values that already exist are not added twice)") });
    new Setting(el).setName(_t("Values to add")).setDesc(_t("One value per line"))
      .addTextArea((t2) => { t2.onChange((v) => (st.text = v)); t2.inputEl.rows = 5; t2.inputEl.style.width = '100%'; });
    new Setting(el).addButton((b) => b.setButtonText(_t("Cancel")).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(_t("Append")).setCta().onClick(async () => {
        const vals = st.text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        if (!vals.length) { new Notice(_t("Please enter at least one value")); return; }
        this.close(); await p.addPropValues(this.props, vals);
      }));
  }
  onClose() { this.contentEl.empty(); }
}

/* ------------------------------ 管理面板：欄位格式與展開文件 ------------------------------ */
// 右鍵選單各項目的預設圖示（設定頁顯示用）
const MENU_ICONS = {"open": "file-text", "openTab": "square-plus", "openRight": "separator-vertical", "openWindow": "app-window", "showInFolder": "folder-search", "selectMode": "check-square", "addZone": "target", "removeZone": "x-circle", "createTemp": "folder-plus", "moveToTemp": "folder-input", "moveOutTemp": "folder-output", "copy": "copy", "cut": "scissors", "paste": "clipboard-paste", "copyPath": "link", "copyName": "copy", "copyFullPath": "link-2", "bookmark": "bookmark", "rename": "pencil", "batchRename": "files", "batchRenameInner": "files", "yamlEdit": "braces", "moveByTags": "tags", "moveByYaml": "folder-input", "appearance": "palette", "sortFolder": "arrow-up-down", "pin": "pin", "unpin": "pin-off", "moveUp": "arrow-up", "moveDown": "arrow-down", "outdent": "corner-left-up", "indent": "corner-right-down", "hideExclude": "eye-off", "selectAllVisible": "check-square", "selectAllAll": "check-check", "newNote": "file-plus", "newFolder": "folder-plus", "newTyped": "file-plus", "dailyNote": "calendar-plus", "batchCreate": "copy-plus", "properties": "info", "delete": "trash"};
const TAG_COL_KEYS = ['num', 'state', 'name', 'note', 'last', 'count'];
const PROP_COL_KEYS = ['num', 'type', 'name', 'count'];
const panelKeys = (panel) => (panel instanceof TagPanel ? TAG_COL_KEYS : PROP_COL_KEYS);
const panelStyleField = (panel) => (panel instanceof TagPanel ? (panel.standalone ? 'tagColStyleTab' : 'tagColStyle') : (panel.standalone ? 'propColStyleTab' : 'propColStyle'));
const panelColKey = (e) => { const c = e && e.target && e.target.closest ? e.target.closest('[data-col]') : null; return c ? c.dataset.col : null; };
function panelCellStyle(cell, key, st, isHead) {
  cell.dataset.col = key;
  const align = st.align || '', off = Math.max(0, Number(st.offset) || 0), wrap = !!st.wrap;
  cell.style.textAlign = align;
  if (!isHead) cell.style.justifyContent = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : align === 'left' ? 'flex-start' : '';
  const depth = Number(cell.dataset.depth || 0) * 14;
  if (key === 'name' && !isHead) cell.style.paddingLeft = depth + (align === 'right' ? 0 : off) + 'px';
  else cell.style.paddingLeft = align === 'right' || !off ? '' : 6 + off + 'px';
  cell.style.paddingRight = align === 'right' && off ? 6 + off + 'px' : '';
  cell.style.whiteSpace = wrap ? 'normal' : '';
  cell.style.wordBreak = wrap ? 'break-all' : '';
  cell.querySelectorAll('.ffm-cell-text').forEach((x) => {
    x.style.whiteSpace = wrap ? 'normal' : '';
    x.style.overflow = wrap ? 'visible' : '';
    x.style.textOverflow = wrap ? 'clip' : '';
  });
}
function panelDecorateHead(panel) {
  const styles = panel.plugin.settings[panelStyleField(panel)] || {};
  const keys = panelKeys(panel);
  [...panel.headEl.querySelectorAll('.ffm-panel-hcell')].forEach((cell, i) => {
    const key = keys[i];
    if (!key) return;
    panelCellStyle(cell, key, styles[key] || {}, true);
    cell.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); panelColMenu(panel, e, key); });
  });
}
function panelDecorate(panel) {
  const styles = panel.plugin.settings[panelStyleField(panel)] || {};
  const keys = panelKeys(panel);
  const anyWrap = keys.some((k) => styles[k] && styles[k].wrap);
  panel.bodyEl.querySelectorAll('.ffm-panel-row').forEach((row) => {
    [...row.children].forEach((cell, i) => { if (keys[i]) panelCellStyle(cell, keys[i], styles[keys[i]] || {}, false); });
    row.style.alignItems = anyWrap ? 'start' : '';
    const key = row.dataset.key || '';
    if (panel instanceof TagPanel && key && !key.startsWith('folder:') && !key.startsWith('file:')) {
      const r = panel.rows.find((x) => x.path === key);
      const nm = row.querySelector('.ffm-name-cell');
      if (r && r.type === 'tag' && r.count > 0 && nm) {
        const open = !!(panel.plugin.settings.tagFilesOpen || {})[key];
        const tg = nm.createSpan({ cls: 'ffm-files-toggle' + (open ? ' is-open' : '') });
        const nameText = nm.querySelector('.ffm-name-text');
        if (nameText && nm.insertBefore) nm.insertBefore(tg, nameText);
        setIcon(tg, open ? 'chevron-up' : 'chevron-down');
        tg.setAttr('aria-label', open ? _t("Hide files using this tag") : _t("Show files using this tag"));
        tg.addEventListener('click', (e) => { e.stopPropagation(); panel.plugin.toggleTagFiles([key]); });
        tg.addEventListener('dblclick', (e) => e.stopPropagation());
      }
    }
    if (key.startsWith('file:')) {
      row.draggable = false; row.addClass('ffm-file-row');
      row.addEventListener('click', () => { const r = panel.rows.find((x) => x.path === key); if (r && r.file) panel.plugin.openFile(r.file); });
    }
  });
}
// 一次性依內容調整欄寬（不會持續自動調整）
function panelAutoFit(panel, key) {
  const isTag = panel instanceof TagPanel;
  const cols = Object.assign({}, panel.cols());
  const targets = key ? [key] : panelKeys(panel);
  targets.forEach((k) => {
    let max = 0;
    [...panel.host.querySelectorAll('.ffm-panel-hcell, .ffm-cell')].filter((c) => c.dataset.col === k).forEach((c) => {
      const kids = [...(c.children || [])];
      let w = kids.length ? kids.reduce((a, x) => a + (Number(x.scrollWidth) || String(x.text || x.textContent || '').length * 8), 0) : String(c.text || c.textContent || '').length * 8;
      w += (parseFloat(c.style.paddingLeft) || 6) + (parseFloat(c.style.paddingRight) || 6);
      max = Math.max(max, w);
    });
    cols[k] = Math.max(40, Math.min(700, Math.ceil(max + 4)));
  });
  panel.plugin.settings[panel.colsField()] = cols;
  panel.plugin.saveSoon();
  panel.render();
}
function panelColMenu(panel, e, key) {
  if (!key) return;
  const p = panel.plugin, field = panelStyleField(panel);
  const all = p.settings[field] || (p.settings[field] = {});
  const st = all[key] || (all[key] = {});
  const set = (patch) => { Object.assign(st, patch); p.saveSoon(); panel.render(); };
  const m = new Menu();
  [['left', 'Align left', 'align-left'], ['center', 'Align center', 'align-center'], ['right', 'Align right', 'align-right']].forEach(([v, label, icon]) =>
    m.addItem((i) => i.setTitle(_t(label)).setIcon(icon).setChecked((st.align || '') === v).onClick(() => set({ align: v }))));
  m.addItem((i) => i.setTitle(_t('Default alignment')).setIcon('align-justify').onClick(() => set({ align: '' })));
  m.addItem((i) => i.setTitle(_t('Custom shift distance…')).setIcon('move-horizontal').onClick(() =>
    new TextPromptModal(p.app, _t('Shift distance (px)'), String(st.offset || 0), (v) => set({ offset: Math.max(0, Number(v) || 0) })).open()));
  m.addItem((i) => i.setTitle(_t('Wrap text (wrap long names instead of showing …)')).setIcon('wrap-text').setChecked(!!st.wrap).onClick(() => set({ wrap: !st.wrap })));
  m.addSeparator();
  m.addItem((i) => i.setTitle(_t('Auto-fit this column')).setIcon('move-horizontal').onClick(() => panelAutoFit(panel, key)));
  m.addItem((i) => i.setTitle(_t('Auto-fit all columns')).setIcon('columns').onClick(() => panelAutoFit(panel, null)));
  m.addSeparator();
  m.addItem((i) => i.setTitle(_t('Reset this column')).setIcon('rotate-ccw').onClick(() => { delete all[key]; p.saveSoon(); panel.render(); }));
  m.showAtMouseEvent(e);
}
// 分頁開啟的管理面板使用獨立的欄寬與欄位格式，不會和左側區域互相影響
TagPanel.prototype.colsField = function () { return this.standalone ? 'tagColsTab' : 'tagCols'; };
PropPanel.prototype.colsField = function () { return this.standalone ? 'propColsTab' : 'propCols'; };
(function wrapPanels() {
  [TagPanel, PropPanel].forEach((C) => {
    const rb = C.prototype.renderBody, rh = C.prototype.renderHead;
    C.prototype.renderBody = function () { rb.call(this); panelDecorate(this); };
    C.prototype.renderHead = function () { rh.call(this); panelDecorateHead(this); };
  });
  // 標籤：在標籤下方展開使用該標籤的文件
  const bm = TagPanel.prototype.buildModel;
  TagPanel.prototype.buildModel = function () {
    const open = this.s.tagFilesOpen || {}, out = [];
    bm.call(this).forEach((r) => {
      out.push(r);
      if (r.type === 'tag' && open[r.path]) {
        this.plugin.tagFilesOf(r.path).forEach((f) => out.push({ type: 'file', path: 'file:' + r.path + '\u0000' + f.path, file: f, tag: r.path, label: f.basename, depth: r.depth + 1, count: '' }));
      }
    });
    return out;
  };
  TagPanel.prototype.selTags = function () { return [...this.sel].filter((k) => !k.startsWith('folder:') && !k.startsWith('file:')); };
  const sr = TagPanel.prototype.startRename;
  TagPanel.prototype.startRename = function (r, row) { if (r.type === 'file') { this.plugin.openFile(r.file); return; } return sr.call(this, r, row); };
})();

/* ------------------------------ 依標籤／YAML 移動文件 ------------------------------ */
class MoveBase extends Modal {
  constructor(app, plugin, files) { super(app); this.plugin = plugin; this.files = files; this.dest = ''; this.picked = null; }
  buildDestination(el) {
    const p = this.plugin;
    new Setting(el).setName(_t("Move to")).setDesc(_t("Enter or choose the destination folder path (created automatically if it does not exist; / means the vault root)"))
      .addText((t2) => {
        t2.setPlaceholder('Archive/2026').setValue(this.dest).onChange((v) => (this.dest = v.trim()));
        attachSuggest(t2.inputEl, (txt) => { const q = String(txt || '').toLowerCase(); return p.folderPaths().filter((x) => !q || x.toLowerCase().includes(q)).slice(0, 12); }, (c) => { this.dest = c; t2.setValue(c); });
      });
  }
  renderMatches(host, list) {
    host.empty();
    if (!this.picked) this.picked = new Set();
    // 只保留仍然符合條件的勾選；新出現的符合檔案預設勾選
    const paths = new Set(list.map((f) => f.path));
    this.picked.forEach((x) => { if (!paths.has(x)) this.picked.delete(x); });
    list.forEach((f) => { if (!this.seen) this.seen = new Set(); if (!this.seen.has(f.path)) { this.seen.add(f.path); this.picked.add(f.path); } });
    host.createDiv({ cls: 'ffm-yaml-chip-label', text: _t("Matching files ({0})", list.length) });
    if (!list.length) { host.createDiv({ cls: 'ffm-empty', text: _t("No matching files") }); return; }
    const box = host.createDiv({ cls: 'ffm-yaml-files ffm-move-list' });
    list.forEach((f) => {
      const row = box.createEl('label', { cls: 'ffm-yaml-file' });
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = this.picked.has(f.path);
      cb.onchange = () => { if (cb.checked) this.picked.add(f.path); else this.picked.delete(f.path); };
      row.createSpan({ text: f.path });
    });
  }
  async doMove(list) {
    const p = this.plugin;
    const chosen = list.filter((f) => this.picked && this.picked.has(f.path));
    if (!chosen.length) { new Notice(_t("Please choose at least one file")); return; }
    const raw = this.dest.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (this.dest.trim() === '') { new Notice(_t("Please enter the destination path first")); return; }
    try {
      if (raw) await p.ensureVaultDir(raw);
      let n = 0, skipped = 0;
      for (const f of chosen) {
        const np = joinPath(raw || '/', f.name);
        if (np === f.path) { skipped++; continue; }
        if (this.app.vault.getAbstractFileByPath(np)) { skipped++; continue; }
        await this.app.fileManager.renameFile(f, np);
        n++;
      }
      new Notice(skipped ? _t("Moved {0} files, skipped {1}", n, skipped) : _t("Moved {0} files", n));
    } catch (e) { new Notice(_t("Move failed: ") + e.message); }
    this.close();
    p.refreshAll();
  }
}

class MoveByTagsModal extends MoveBase {
  constructor(app, plugin, files) { super(app, plugin, files); this.inc = new Set(); this.exc = new Set(); this.mode = 'all'; }
  fileTags(f) { const c = this.app.metadataCache.getFileCache(f); return (c ? getAllTags(c) || [] : []).map((t) => t.replace(/^#/, '')); }
  has(tags, x) { return tags.some((t) => t === x || t.startsWith(x + '/')); }
  matched() {
    const inc = [...this.inc], exc = [...this.exc];
    return this.files.filter((f) => {
      const tags = this.fileTags(f);
      if (exc.some((x) => this.has(tags, x))) return false;
      if (!inc.length) return true;
      return this.mode === 'all' ? inc.every((x) => this.has(tags, x)) : inc.some((x) => this.has(tags, x));
    });
  }
  onOpen() {
    const el = this.contentEl;
    this.modalEl.addClass('ffm-icon-modal');
    this.titleEl.setText(_t("Move files by tags ({0} files)", this.files.length));
    const counts = new Map();
    this.files.forEach((f) => new Set(this.fileTags(f)).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    el.createEl('p', { cls: 'setting-item-description', text: _t("Click a tag to cycle: include (green) → exclude (red) → unused") });
    this.chipsEl = el.createDiv({ cls: 'ffm-yaml-chip-row ffm-move-chips' });
    const drawChips = () => {
      this.chipsEl.empty();
      [...counts.entries()].sort((a, b) => b[1] - a[1] || yamlCmp(a[0], b[0])).forEach(([t, c]) => {
        const chip = this.chipsEl.createSpan({ cls: 'ffm-yaml-chip' + (this.inc.has(t) ? ' is-inc' : this.exc.has(t) ? ' is-exc' : ''), text: `#${t} (${c})` });
        chip.onclick = () => {
          if (this.inc.has(t)) { this.inc.delete(t); this.exc.add(t); } else if (this.exc.has(t)) this.exc.delete(t); else this.inc.add(t);
          drawChips(); this.renderMatches(this.listEl, this.matched());
        };
      });
      if (!counts.size) this.chipsEl.createDiv({ cls: 'ffm-empty', text: _t("(The selected files have no tags)") });
    };
    drawChips();
    new Setting(el).setName(_t("How included tags are matched")).addDropdown((d) => {
      d.addOption('all', _t("Must contain all selected tags")); d.addOption('any', _t("Contains any selected tag"));
      d.setValue(this.mode); d.onChange((v) => { this.mode = v; this.renderMatches(this.listEl, this.matched()); });
    });
    this.listEl = el.createDiv();
    this.buildDestination(el);
    new Setting(el).addButton((b) => b.setButtonText(_t("Cancel")).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(_t("Move")).setCta().onClick(() => this.doMove(this.matched())));
    this.renderMatches(this.listEl, this.matched());
  }
  onClose() { this.contentEl.empty(); }
}

class MoveByYamlModal extends MoveBase {
  constructor(app, plugin, files) { super(app, plugin, files); this.docs = new Map(); this.conds = []; this.props = new Map(); }
  freshCond() { return { kind: 'include', prop: '', op: 'has', values: [], from: '', to: '' }; }
  async onOpen() {
    const el = this.contentEl;
    this.modalEl.addClass('ffm-yaml-modal');
    this.titleEl.setText(_t("Move files by YAML ({0} files)", this.files.length));
    for (const f of this.files) {
      try { const src = yamlSplit(await this.app.vault.cachedRead(f)); this.docs.set(f.path, src === null ? {} : yamlParseSafe(src).obj); } catch (e) { this.docs.set(f.path, {}); }
    }
    this.docs.forEach((o) => Object.entries(o).forEach(([k, v]) => {
      const e = this.props.get(k) || { count: 0, values: new Map() };
      e.count++;
      (Array.isArray(v) ? v : [v]).forEach((x) => { if (x !== null && typeof x !== 'object') e.values.set(String(x), (e.values.get(String(x)) || 0) + 1); });
      this.props.set(k, e);
    }));
    el.createEl('p', { cls: 'setting-item-description', text: _t("Add conditions to filter files (all conditions must match). Date and date + time properties can use a range.") });
    this.condEl = el.createDiv({ cls: 'ffm-move-conds' });
    const add = el.createEl('button', { cls: 'ffm-btn', text: _t("+ Add condition") });
    add.onclick = () => { const c = this.freshCond(); c.prop = [...this.props.keys()][0] || ''; this.conds.push(c); this.renderConds(); this.renderMatches(this.listEl, this.matched()); };
    this.listEl = el.createDiv();
    this.buildDestination(el);
    new Setting(el).addButton((b) => b.setButtonText(_t("Cancel")).onClick(() => this.close()))
      .addButton((b) => b.setButtonText(_t("Move")).setCta().onClick(() => this.doMove(this.matched())));
    this.renderConds();
    this.renderMatches(this.listEl, this.matched());
  }
  propType(name) { const d = this.plugin.propData().get(name); return d ? d.type : 'text'; }
  isDate(name) { const t = this.propType(name); return t === 'date' || t === 'datetime'; }
  hit(c, obj) {
    if (!c.prop || !yamlHas(obj, c.prop) || obj[c.prop] === null || obj[c.prop] === undefined) return false;
    if (c.op === 'has') return true;
    const v = obj[c.prop];
    if (c.op === 'value') { const vals = (Array.isArray(v) ? v : [v]).map(String); return c.values.length > 0 && vals.some((x) => c.values.includes(x)); }
    const m = obsidian.moment(String(Array.isArray(v) ? v[0] : v));
    if (!m.isValid()) return false;
    if (c.from && m.valueOf() < obsidian.moment(c.from).valueOf()) return false;
    if (c.to && m.valueOf() > obsidian.moment(c.to).valueOf()) return false;
    return !!(c.from || c.to);
  }
  matched() {
    return this.files.filter((f) => { const obj = this.docs.get(f.path) || {}; return this.conds.every((c) => (c.kind === 'exclude' ? !this.hit(c, obj) : this.hit(c, obj))); });
  }
  renderConds() {
    const host = this.condEl;
    host.empty();
    const redraw = () => { this.renderConds(); this.renderMatches(this.listEl, this.matched()); };
    const refreshMatches = () => this.renderMatches(this.listEl, this.matched());
    this.conds.forEach((c, i) => {
      const card = host.createDiv({ cls: 'ffm-move-cond' });
      const top = card.createDiv({ cls: 'ffm-move-cond-top' });
      const kind = top.createEl('select', { cls: 'dropdown' });
      [['include', _t("Include")], ['exclude', _t("Exclude")]].forEach(([v, l]) => kind.createEl('option', { value: v, text: _t(l) }));
      kind.value = c.kind; kind.onchange = () => { c.kind = kind.value; refreshMatches(); };
      const prop = top.createEl('select', { cls: 'dropdown' });
      [...this.props.keys()].forEach((k) => prop.createEl('option', { value: k, text: k }));
      prop.value = c.prop; prop.onchange = () => { c.prop = prop.value; c.op = this.isDate(c.prop) ? 'range' : 'has'; c.values = []; redraw(); };
      const op = top.createEl('select', { cls: 'dropdown' });
      const ops = this.isDate(c.prop) ? [['range', _t("Date range")], ['value', _t("Specific values")], ['has', _t("Has the property")]] : [['has', _t("Has the property")], ['value', _t("Specific values")]];
      ops.forEach(([v, l]) => op.createEl('option', { value: v, text: _t(l) }));
      op.value = ops.some((x) => x[0] === c.op) ? c.op : ops[0][0]; c.op = op.value;
      op.onchange = () => { c.op = op.value; redraw(); };
      const del = top.createEl('button', { cls: 'ffm-x', text: '✕' });
      del.setAttr('aria-label', _t("Remove condition"));
      del.onclick = () => { this.conds.splice(i, 1); redraw(); };
      if (c.op === 'value') {
        const row = card.createDiv({ cls: 'ffm-yaml-chip-row' });
        const e = this.props.get(c.prop);
        [...(e ? e.values.entries() : [])].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([v, n]) => {
          const chip = row.createSpan({ cls: 'ffm-yaml-chip' + (c.values.includes(v) ? ' is-inc' : ''), text: `${v} (${n})` });
          chip.onclick = () => { if (c.values.includes(v)) c.values = c.values.filter((x) => x !== v); else c.values.push(v); redraw(); };
        });
      } else if (c.op === 'range') {
        const dt = this.propType(c.prop) === 'datetime';
        const row = card.createDiv({ cls: 'ffm-move-range' });
        const mk = (label, key) => {
          row.createSpan({ text: _t(label) });
          const inp = row.createEl('input', { type: dt ? 'datetime-local' : 'date' });
          inp.value = c[key] || '';
          inp.onchange = () => { c[key] = inp.value; refreshMatches(); };
        };
        mk(_t("From"), 'from'); mk(_t("To"), 'to');
      }
    });
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
    this.el.toggleClass('ffm-open-sticky', s.openIconSticky !== false);
    const inSide = !!(this.el.closest && this.el.closest('.mod-left-split, .mod-right-split'));
    this.el.style.setProperty('--ffm-open-bg', inSide ? 'var(--background-secondary)' : 'var(--background-primary)');
    if (s.highlightColor) this.el.style.setProperty('--ffm-new-hl', parseColor(s.highlightColor, p.aliasMap));
    else this.el.style.removeProperty('--ffm-new-hl');
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
    if (this.pendingScroll) {
      const target = [...this.el.querySelectorAll('.ffm-row')].find((r) => r.dataset.path === this.pendingScroll);
      if (target) { if (target.scrollIntoView) target.scrollIntoView({ block: 'center' }); this.pendingScroll = null; }
    }
  }

  // 定位並（可選）高亮某個項目：展開上層文件夾／切換到所在資料夾，再捲動到該列
  reveal(file, o) {
    const p = this.plugin;
    if (this.cfg.isZone || !file) return;
    if (o.locate) {
      const enter = !!(o.enter && file instanceof TFolder);
      if (this.isExplorer()) {
        const dest = enter ? file : file.parent || p.app.vault.getRoot();
        const v = p.validFolderPath(dest.path);
        if (v !== null && v !== p.nav.path) { p.nav.back.push(p.nav.path); p.nav.fwd = []; p.nav.path = v; p.settings.explorerPath = v; p.saveSoon(); }
      } else {
        const m = this.expandedMap();
        for (let a = file.parent; a && !a.isRoot(); a = a.parent) m[a.path] = true;
        if (enter) m[file.path] = true;
        p.saveSoon();
      }
      if (!enter || !this.isExplorer()) { this.pendingScroll = file.path; this.selection = new Set([file.path]); this.lastClicked = file.path; }
    }
    if (o.highlight) this.hl = { path: file.path, until: Date.now() + 3600 };
    this.render();
    p.views.forEach((v) => v.updateToolbar());
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
    if (this.hl && this.hl.path === file.path && Date.now() < this.hl.until) row.addClass('is-new');
    if (s.showExcluded && p.isExcludedDeep(file.path)) row.addClass('is-excluded');

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
    const showOpen = s.showOpenIcon !== false;
    const showTab = s.showTabButton !== false;
    if (!folder && (showOpen || showTab)) {
      const box = row.createSpan({ cls: 'ffm-open' });
      const mk = (icon, tip, how) => {
        const btn = box.createSpan({ cls: ['ffm-open-btn', how === 'tab' ? 'ffm-open-tab' : 'ffm-open-main'] });
        setIcon(btn, pickIcon(icon));
        btn.setAttr('aria-label', tip);
        btn.addEventListener('click', (e) => { e.stopPropagation(); p.openFile(file, how); });
      };
      if (showOpen) mk('external-link', s.openMode === 'tab' ? p.tabLabel() : _t("Open"), s.openMode === 'tab' ? 'tab' : 'current');
      if (showTab && !(showOpen && s.openMode === 'tab')) mk('square-plus|plus-square', p.tabLabel(), 'tab');
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
    const walk = (f) => {
      if (!this.plugin.settings.showExcluded && this.plugin.isExcluded(f.path)) return;
      all.add(f.path);
      if (f instanceof TFolder) f.children.forEach(walk);
    };
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
    const p = this.plugin, m = new Menu();
    const sel = this.getSelectedFiles();
    const ctx = {
      e, file, sel, desktop: Platform.isDesktop,
      openables: sel.filter((f) => f instanceof TFile),
      rootSel: sel.filter((f) => this.roots.has(f.path)),
    };
    const reg = p.menuRegistry(this, ctx);
    const byId = new Map(reg.map((x) => [x.id, x]));
    const hidden = new Set(p.settings.menuHidden || []);
    const icons = p.settings.menuIcons || {};
    const explicitSep = !!p.settings.menuSepExplicit;
    let prev = null, pendingSep = false;
    for (const id of p.menuOrderList(reg.map((x) => x.id))) {
      if (String(id).startsWith('sep:')) { pendingSep = true; continue; }
      const en = byId.get(id);
      if (!en || hidden.has(id) || !en.show()) continue;
      const items = en.items();
      if (!items.length) continue;
      if (prev !== null && (pendingSep || (!explicitSep && en.group !== prev))) m.addSeparator();
      pendingSep = false;
      items.forEach((x) => m.addItem((i) => i.setTitle(x.title).setIcon(icons[id] || x.icon).onClick(x.fn)));
      prev = en.group;
    }
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
      add(_t("Create daily note from template"), 'calendar-plus', () => p.dailyMenu(e, root));
      add(_t("Batch create…"), 'copy-plus', () => new BatchCreateModal(p.app, p, root).open());
      if (p.settings.sortMode === 'manual') add(_t("Sort this folder…"), 'arrow-up-down', () => p.sortFolderMenu(e, root));
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

/* ------------------------------ 標籤／屬性管理：獨立分頁 ------------------------------ */
class ManagerView extends ItemView {
  constructor(leaf, plugin, kind) { super(leaf); this.plugin = plugin; this.kind = kind; }
  getViewType() { return this.kind === 'tags' ? VIEW_TAGS : VIEW_PROPS; }
  getDisplayText() { return this.kind === 'tags' ? _t("Tag manager") : _t("Property manager"); }
  getIcon() { return this.kind === 'tags' ? 'tags' : 'list-checks'; }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('ffm-root');
    this.host = this.contentEl.createDiv({ cls: 'ffm-panel-host' });
    this.panel = this.kind === 'tags' ? new TagPanel(this.plugin, this.host) : new PropPanel(this.plugin, this.host);
    this.panel.standalone = true;
    this.panel.render();
  }
  async onClose() { this.panel = null; }
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
    this.panelHost = left.createDiv({ cls: 'ffm-panel-host' });
    this.panelHost.style.display = 'none';
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
        b.onclick = async () => { s.layoutMode = k; if (k === 'tree') s.leftMode = 'files'; this.updateToolbar(); await p.saveSettings(); p.refreshAll(); };
        this.modeBtns[k] = b;
      });
    }

    this.tagBtn = this.makeBtn(bar);
    this.tagBtn.onclick = () => p.setLeftMode(s.leftMode === 'tags' ? 'files' : 'tags');
    this.propBtn = this.makeBtn(bar);
    this.propBtn.onclick = () => p.setLeftMode(s.leftMode === 'props' ? 'files' : 'props');
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
      [['top', 'Folders at the top'], ['bottom', 'Folders at the bottom'], ['mixed-before', 'Mixed by name: folder before its file'], ['mixed-after', 'Mixed by name: folder after its file']].forEach(([k, label]) =>
        m.addItem((i) => i.setTitle(_t(label)).setChecked((s.sortFolderPos || (s.sortFoldersFirst === false ? 'mixed-after' : 'top')) === k).onClick(async () => { s.sortFolderPos = k; await p.saveSettings(); p.refreshAll(); })));
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

    this.eyeBtn = this.makeBtn(bar);
    this.eyeBtn.onclick = async () => { s.showExcluded = !s.showExcluded; await p.saveSettings(); p.refreshAll(); };
    const gear = this.makeBtn(bar);
    this.setBtn(gear, { icon: 'settings', label: _t("Plugin settings"), tip: _t("Open plugin settings") });
    gear.onclick = () => p.openSettings();
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
    if (this.tagBtn) this.setBtn(this.tagBtn, { icon: 'tags', label: _t("Tag manager"), tip: _t("Tag manager"), on: s.leftMode === 'tags' });
    if (this.propBtn) this.setBtn(this.propBtn, { icon: 'list-checks', label: _t("Property manager"), tip: _t("Property manager"), on: s.leftMode === 'props' });
    if (this.eyeBtn) {
      const shown = s.showExcluded ? _t("Shown") : _t("Hidden");
      this.setBtn(this.eyeBtn, { icon: s.showExcluded ? 'eye' : 'eye-off', label: _t("Excluded files: {0}", shown), tip: _t("Click to show or hide excluded files and folders"), on: !!s.showExcluded });
    }
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
    this.applyLeftMode();
  }
  updateIndicators() { if (this.treePane) { this.treePane.updateIndicators(); this.zonePane.updateIndicators(); } }

  // 左側區域：文件管理／標籤管理／屬性管理
  applyLeftMode() {
    const mode = this.plugin.settings.leftMode || 'files';
    const files = mode === 'files';
    this.leftEl.toggleClass('ffm-left-panel', !files);
    this.panelHost.style.display = files ? 'none' : '';
    if (files) return;
    if (!this.panel || this.panelMode !== mode) {
      this.panelHost.empty();
      this.panel = mode === 'tags' ? new TagPanel(this.plugin, this.panelHost) : new PropPanel(this.plugin, this.panelHost);
      this.panelMode = mode;
    }
    this.panel.render();
  }
  refreshPanel() { if ((this.plugin.settings.leftMode || 'files') !== 'files' && this.panel) this.panel.render(); }
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
    // 在 Obsidian 執行中手動啟用本插件時（不是啟動時還原版面），自動在左側欄開啟
    if (this.settings.openOnEnable !== false && this.app.workspace.layoutReady) {
      this.app.workspace.onLayoutReady(() => { this.activateView('sidebar'); });
    }
    this.addRibbonIcon('folder-tree', _t("Focus File Manager"), () => this.activateView('sidebar'));
    this.addCommand({ id: 'open-focus-file-manager-sidebar', name: _t("Open Focus File Manager in sidebar"), callback: () => this.activateView('sidebar') });
    this.addCommand({ id: 'open-focus-file-manager-main', name: _t("Open Focus File Manager in main area"), callback: () => this.activateView('main') });
    [['show-tree-only', _t("Show file manager only"), 'tree'], ['show-zone-only', _t("Show focus zone only"), 'zone'], ['show-both', _t("Show both"), 'both']].forEach(([id, name, mode]) =>
      this.addCommand({ id, name, callback: () => this.setLayoutMode(mode) }));
    this.addCommand({ id: 'cycle-layout', name: _t("Cycle view (File manager → Focus zone → Both)"), callback: () => this.cycleLayoutMode() });
    this.tagTerms = [];
    this.requestPanels = debounce(() => { this.invalidateMeta(); this.refreshPanels(); }, 400, true);
    this.registerView(VIEW_TAGS, (leaf) => new ManagerView(leaf, this, 'tags'));
    this.registerView(VIEW_PROPS, (leaf) => new ManagerView(leaf, this, 'props'));
    [
      ['open-tag-manager-tab', _t("Open tag manager in a tab"), () => this.openManagerTab('tags')],
      ['open-prop-manager-tab', _t("Open property manager in a tab"), () => this.openManagerTab('props')],
      ['show-tag-manager', _t("Show tag manager in the left area"), () => this.setLeftMode('tags')],
      ['show-prop-manager', _t("Show property manager in the left area"), () => this.setLeftMode('props')],
      ['show-file-manager-left', _t("Show file manager in the left area"), () => this.setLeftMode('files')],
    ].forEach(([id, name, callback]) => this.addCommand({ id, name, callback }));
    this.memClip = null;
    this.initNav();
    this.addSettingTab(new FFMSettingTab(this.app, this));
    this.registerDomEvent(document, 'click', (e) => this.onHeaderPathClick(e), true);
    this.registerDomEvent(document, 'mousedown', (e) => this.onHeaderTitleEvent(e), true);
    this.registerDomEvent(document, 'dblclick', (e) => this.onHeaderTitleEvent(e), true);
    this.registerDomEvent(document, 'click', (e) => this.onTagClick(e), true);
    // 分頁標籤右鍵：在本插件中定位該文件
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source) => {
      if (source !== 'tab-header' || !(file instanceof TFile)) return;
      menu.addItem((i) => i.setTitle(_t("Locate in Focus File Manager")).setIcon('crosshair').onClick(() => this.locateFile(file, true)));
    }));

    this.app.workspace.onLayoutReady(() => {
      this.computeOpen();
      const mc = this.app.metadataCache;
      try { this.registerEvent(this.app.vault.on('raw', (path) => { if (String(path).endsWith('types.json')) this.loadTypesFile(); })); } catch (e) { /* ignore */ }
      this.registerEvent(mc.on('changed', (f) => this.onMetaChanged(f)));
      this.registerEvent(mc.on('deleted', () => this.requestPanels()));
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
    ['menuIcons', 'tagMeta', 'tagExpanded', 'tagCols', 'propCols', 'propExpanded', 'tagPanel', 'propPanel', 'tagColStyle', 'propColStyle', 'tagFilesOpen', 'tagColsTab', 'propColsTab', 'tagColStyleTab', 'propColStyleTab'].forEach((k) => { if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = clone(DEFAULT_SETTINGS[k]); });
    ['menuOrder', 'menuHidden', 'yamlSchemes', 'propFolders', 'tagFolders', 'tagOrder', 'tagCustom', 'propOrder', 'propCustom'].forEach((k) => { if (!Array.isArray(s[k])) s[k] = []; });
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
    if (!s.showExcluded) kids = kids.filter((k) => !this.isExcluded(k.path));
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    const pos = s.sortFolderPos || (s.sortFoldersFirst === false ? 'mixed-after' : 'top');
    const mixed = pos === 'mixed-before' || pos === 'mixed-after';
    const tm = /^(mtime|ctime)-(asc|desc)$/.exec(mode);
    // 混合排序：名稱以某個文件名稱開頭的資料夾，歸入該文件的群組（例如 A-image 與 A.md）
    const bases = mixed ? kids.filter((k) => k instanceof TFile).map((k) => k.basename).filter(Boolean) : [];
    const groupKey = (k) => {
      if (k instanceof TFile) return k.basename;
      const low = k.name.toLowerCase();
      let best = '';
      for (const b of bases) if (low.startsWith(b.toLowerCase()) && b.length > best.length) best = b;
      return best ? k.name.slice(0, best.length) : k.name;
    };
    const coll = (x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
    kids.sort((a, b) => {
      const af = a instanceof TFolder, bf = b instanceof TFolder;
      if (!mixed && af !== bf) return (pos === 'top') === af ? -1 : 1;
      if (tm) {
        const d = this.folderTime(a, tm[1]) - this.folderTime(b, tm[1]);
        if (d) return tm[2] === 'desc' ? -d : d;
        return byName(a, b);
      }
      if (mixed) {
        const d = coll(groupKey(a), groupKey(b));
        if (d) return mode === 'name-desc' ? -d : d;
        if (af !== bf) return (pos === 'mixed-before') === af ? -1 : 1;
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
  async createExcalidrawFile(folder, name) {
    const ex = this.getPlugin('obsidian-excalidraw-plugin');
    if (!ex || !ex.ea) { new Notice(_t("Excalidraw plugin not found; make sure it is enabled")); return null; }
    try {
      if (ex.ea.reset) ex.ea.reset();
      const path = await ex.ea.create({
        filename: name.replace(/\.excalidraw(\.md)?$/i, '').replace(/\.md$/i, ''),
        foldername: folder.isRoot() ? undefined : folder.path,
        silent: true,
      });
      const f = path ? this.app.vault.getAbstractFileByPath(path) : null;
      return f instanceof TFile ? f : null;
    } catch (e) { new Notice(_t("Failed to create Excalidraw: ") + e.message); return null; }
  }
  async createExcalidraw(folder, name) {
    const f = await this.createExcalidrawFile(folder, name);
    if (f) { this.openFile(f); this.revealItem(f); }
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
        let created;
        if (def) created = await this.app.vault.create(path, def.content || '');
        else if (kind === 'note') created = await this.app.vault.create(path, '');
        else created = await this.app.vault.createFolder(path);
        this.expandFolder(folder);
        this.revealItem(created && created.path ? created : this.app.vault.getAbstractFileByPath(path));
      } catch (e) { new Notice(_t("Create failed: ") + e.message); }
    }).open();
  }

  /* ---- 新增後定位／高亮、路徑點擊 ---- */
  revealItem(file, opts) {
    const s = this.settings;
    const o = Object.assign({ locate: s.locateNew !== false, highlight: s.highlightNew !== false }, opts || {});
    if (!file || (!o.locate && !o.highlight)) return;
    this.views.forEach((v) => { if (v.treePane) v.treePane.reveal(file, o); });
  }
  async revealFolder(path) {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!existing) await this.activateView('sidebar'); else ws.revealLeaf(existing);
    const folder = path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) return;
    if (this.settings.layoutMode === 'zone') { this.settings.layoutMode = 'both'; await this.saveSettings(); }
    this.revealItem(folder, { locate: true, enter: true });
  }
  // 點擊筆記標題上方（分頁欄下方）的路徑：優先交給本插件定位
  onHeaderPathClick(e) {
    if (this.onHeaderTitleEvent(e)) return;
    if (this.settings.headerPathPrefer === false) return;
    const target = e.target;
    if (!target || !target.closest) return;
    const crumb = target.closest('.view-header-breadcrumb');
    if (!crumb || !crumb.parentElement) return;
    const crumbs = [...crumb.parentElement.querySelectorAll('.view-header-breadcrumb')];
    const i = crumbs.indexOf(crumb);
    if (i < 0) return;
    const path = crumbs.slice(0, i + 1).map((x) => x.textContent.trim()).filter(Boolean).join('/');
    const v = this.validFolderPath(path);
    if (v === null) return; // 找不到對應的資料夾：保留 Obsidian 預設行為
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    this.revealFolder(v);
  }
  async locateFile(file, force) {
    const s = this.settings;
    if (this.isExcludedDeep(file.path) && !s.showExcluded) { new Notice(_t("This file is excluded (hidden); show excluded files first")); return; }
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!existing) await this.activateView('sidebar'); else ws.revealLeaf(existing);
    if (s.layoutMode === 'zone') { s.layoutMode = 'both'; await this.saveSettings(); }
    this.revealItem(file, { locate: true, highlight: force ? true : s.highlightNew !== false });
  }
  fileForElement(el) {
    let found = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!found && leaf.view && leaf.view.containerEl && leaf.view.containerEl.contains(el) && leaf.view.file instanceof TFile) found = leaf.view.file;
    });
    return found;
  }
  // 分頁欄下方的檔名：單擊 → 在本插件定位；雙擊 → 進入重新命名。回傳 true 表示已處理
  onHeaderTitleEvent(e) {
    if (this.settings.headerTitleLocate === false) return false;
    const target = e.target;
    if (!target || !target.closest) return false;
    const title = target.closest('.view-header-title');
    if (!title || title.closest('.ffm-root')) return false;
    if (typeof document !== 'undefined' && document.activeElement === title) return false; // 正在重新命名時不攔截
    const file = this.fileForElement(title);
    if (!file) return false;
    if (e.type === 'mousedown') { e.preventDefault(); return true; }
    e.preventDefault(); e.stopPropagation();
    if (this._titleTimer) { clearTimeout(this._titleTimer); this._titleTimer = null; }
    if (e.type === 'dblclick') {
      title.focus();
      try { const r = document.createRange(); r.selectNodeContents(title); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (err) { /* ignore */ }
      return true;
    }
    // 單擊：等待一個雙擊判定時間再定位；若是雙擊（第二下或 dblclick）就不定位
    if ((e.detail || 1) < 2) this._titleTimer = setTimeout(() => { this._titleTimer = null; this.locateFile(file); }, Number(this.settings.doubleClickMs) || 300);
    return true;
  }
  // 筆記中的標籤：單擊不跳轉到搜尋（可直接編輯），雙擊才搜尋
  tagTextFrom(el) {
    const clean = (x) => String(x || '').trim().replace(/^#/, '');
    if ((el.matches && el.matches('a.tag')) || (el.closest && el.closest('.metadata-property'))) return clean(el.textContent);
    let first = el;
    while (first.previousElementSibling && first.previousElementSibling.classList.contains('cm-hashtag') && !first.classList.contains('cm-hashtag-begin')) first = first.previousElementSibling;
    let txt = '', cur = first;
    while (cur && cur.classList && cur.classList.contains('cm-hashtag')) {
      txt += cur.textContent;
      if (cur.classList.contains('cm-hashtag-end')) break;
      cur = cur.nextElementSibling;
    }
    return clean(txt);
  }
  searchTag(tag) { this.openSearch('tag:#' + tag); }
  onTagClick(e) {
    if (this.settings.tagClickEdit === false) return;
    const t = e.target;
    if (!t || !t.closest) return;
    const hit = t.closest('.cm-hashtag, a.tag, .metadata-property[data-property-key="tags"] .multi-select-pill');
    if (!hit || hit.closest('.ffm-root')) return;
    const tag = this.tagTextFrom(hit);
    if (!tag) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if ((e.detail || 1) >= 2) this.searchTag(tag);
  }
  openSettings() {
    try {
      const st = this.app.setting;
      st.open();
      st.openTabById(this.manifest.id);
    } catch (e) { new Notice(_t("Open this plugin's settings under \"Settings → Community plugins\"")); }
  }

  /* ---- 模板日記 ---- */
  dailyTemplateList() {
    const out = [], seen = new Set();
    const add = (x) => { if (x instanceof TFile && x.extension === 'md' && !seen.has(x.path)) { seen.add(x.path); out.push(x); } };
    String(this.settings.dailyTemplates || '').split('\n').forEach((line) => {
      const path = line.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (!path) return;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) add(f);
      else if (f instanceof TFolder) { const walk = (d) => [...d.children].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).forEach((c) => (c instanceof TFolder ? walk(c) : add(c))); walk(f); }
    });
    return out;
  }
  fillTemplate(text, title, now) {
    return text.replace(/\{\{\s*(date|time|title)\s*(?::\s*([^}]+?))?\s*\}\}/gi, (m, kind, fmt) => {
      kind = kind.toLowerCase();
      if (kind === 'title') return title;
      return now.format(fmt ? fmt.trim() : kind === 'date' ? 'YYYY-MM-DD' : 'HH:mm');
    });
  }
  async createDailyNote(folder, tpl) {
    try {
      const now = obsidian.moment();
      const name = now.format(this.settings.dailyNameFormat || 'YYYY-MM-DD');
      if (INVALID_NAME.test(name)) { new Notice(_t("The name contains invalid characters")); return; }
      const path = joinPath(folder.path, name + '.md');
      const exist = this.app.vault.getAbstractFileByPath(path);
      if (exist instanceof TFile) { new Notice(_t("Today's note already exists: {0}", name)); try { this.openFile(exist); } catch (e) { /* ignore */ } this.revealItem(exist); return; }
      let content = '';
      if (tpl) content = this.fillTemplate(await this.app.vault.cachedRead(tpl), name, now);
      const f = await this.app.vault.create(path, content);
      this.expandFolder(folder);
      new Notice(_t("Daily note created: {0}", name));
      try { this.openFile(f); } catch (e) { /* 開啟失敗不影響建立結果 */ }
      this.revealItem(f);
    } catch (e) { new Notice(_t("Create failed: ") + e.message); }
  }
  dailyMenu(e, folder) {
    const list = this.dailyTemplateList();
    if (list.length === 1) { this.createDailyNote(folder, list[0]); return; }
    const dup = new Set(list.map((f) => f.basename).filter((n, i, a) => a.indexOf(n) !== i));
    const m = new Menu();
    list.forEach((f) => m.addItem((i) => i.setTitle(dup.has(f.basename) ? f.path.replace(/\.md$/, '') : f.basename).setIcon('file-text').onClick(() => this.createDailyNote(folder, f))));
    if (list.length) m.addSeparator();
    m.addItem((i) => i.setTitle(_t("Blank daily note (no template)")).setIcon('file').onClick(() => this.createDailyNote(folder, null)));
    m.showAtMouseEvent(e);
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

  /* ---- 排除（隱藏）清單 ---- */
  hiddenRules() {
    const key = String(this.settings.hiddenList || '');
    if (this._hrKey === key && this._hr) return this._hr;
    const rules = [];
    key.split('\n').forEach((line) => {
      const raw = line.trim();
      if (!raw) return;
      const norm = raw.replace(/\\/g, '/');
      const byPath = norm.startsWith('/') || norm.includes('/');
      const x = norm.replace(/^\/+|\/+$/g, '');
      if (x) rules.push({ raw, byPath, re: globRe(x) });
    });
    this._hr = rules; this._hrKey = key;
    return rules;
  }
  isExcluded(path) {
    const rules = this.hiddenRules();
    if (!rules.length) return false;
    const name = path.split('/').pop();
    return rules.some((r) => r.re.test(r.byPath ? path : name));
  }
  isExcludedDeep(path) {
    if (!this.hiddenRules().length) return false;
    let acc = '';
    for (const part of path.split('/')) { acc = acc ? acc + '/' + part : part; if (this.isExcluded(acc)) return true; }
    return false;
  }
  async toggleExcluded(files) {
    const s = this.settings;
    const lines = String(s.hiddenList || '').split('\n').map((x) => x.trim()).filter(Boolean);
    if (files.every((f) => this.isExcluded(f.path))) {
      for (const f of files) {
        const k = lines.findIndex((x) => x === '/' + f.path || x === f.path);
        if (k >= 0) lines.splice(k, 1);
        else {
          const rule = this.hiddenRules().find((r) => r.re.test(r.byPath ? f.path : f.name));
          new Notice(_t("This item is hidden by the exclusion rule \"{0}\"; change it in the settings", rule ? rule.raw : ''));
        }
      }
    } else {
      for (const f of files) if (!this.isExcluded(f.path)) lines.push('/' + f.path);
    }
    s.hiddenList = lines.join('\n');
    await this.saveSettings();
    this.views.forEach((v) => { if (v.treePane) v.treePane.selection = new Set(); });
    this.refreshAll();
  }
  collectMarkdown(sel) {
    const out = [], seen = new Set();
    const walk = (f) => {
      if (!this.settings.showExcluded && this.isExcluded(f.path)) return;
      if (f instanceof TFolder) f.children.forEach(walk);
      else if (f instanceof TFile && f.extension === 'md' && !seen.has(f.path)) { seen.add(f.path); out.push(f); }
    };
    (sel || []).forEach(walk);
    return out;
  }

  /* ---- 右鍵選單：功能清單（可在設定中調整順序與開關） ---- */
  menuOrderList(defaultIds) {
    const saved = (this.settings.menuOrder || []).filter((id) => defaultIds.includes(id) || String(id).startsWith('sep:'));
    const out = [...new Set(saved)];
    defaultIds.forEach((id, i) => {
      if (out.includes(id)) return;
      let at = out.length;
      for (let k = i - 1; k >= 0; k--) { const pos = out.indexOf(defaultIds[k]); if (pos >= 0) { at = pos + 1; break; } }
      out.splice(at, 0, id);
    });
    return out;
  }
  menuRegistry(pane, ctx) {
    const p = this;
    const { e, file, sel, desktop, openables, rootSel } = ctx;
    const it = (title, icon, fn) => ({ title, icon, fn });
    const isZone = () => !!(pane && pane.cfg.isZone);
    const zone = () => (isZone() ? p.activeZoneObj() : null);
    const isFolder = () => file instanceof TFolder;
    return [
      { id: 'open', group: 1, label: _t("Open"), show: () => openables.length > 0, items: () => [it(_t("Open"), 'file-text', () => openables.forEach((f) => p.openFile(f)))] },
      { id: 'openTab', group: 1, label: _t("Open in new tab"), show: () => openables.length > 0, items: () => [it(p.tabLabel(), 'square-plus', () => openables.forEach((f) => p.openFile(f, 'tab')))] },
      { id: 'openRight', group: 1, label: _t("Open to the right"), show: () => openables.length > 0, items: () => [it(_t("Open to the right"), 'separator-vertical', () => openables.forEach((f) => p.openFile(f, 'split')))] },
      { id: 'openWindow', group: 1, label: _t("Open in new window"), show: () => !!desktop && openables.length > 0, items: () => [it(_t("Open in new window"), 'app-window', () => openables.forEach((f) => p.openFile(f, 'window')))] },
      { id: 'showInFolder', group: 1, label: _t("Show in folder"), show: () => !!desktop, items: () => [it(_t("Show in folder"), 'folder-search', () => p.showInFolder(file))] },
      { id: 'selectMode', group: 2, label: _t("Selection mode (enter / exit)"), show: () => true,
        items: () => [pane.selectMode ? it(_t("Exit selection mode"), 'x', () => pane.exitSelectMode()) : it(_t("Enter selection mode"), 'check-square', () => pane.enterSelectMode(file.path))] },
      { id: 'addZone', group: 3, label: _t("Add to focus zone…"), show: () => true, items: () => [it(_t("Add to focus zone…"), 'target', () => new AddToZoneModal(p.app, p, sel).open())] },
      { id: 'removeZone', group: 3, label: _t("Remove from focus zone"), show: () => isZone() && rootSel.length > 0,
        items: () => [it(_t("Remove from focus zone ({0})", rootSel.length), 'x-circle', () => p.removeFromZone(rootSel.map((f) => f.path)))] },
      { id: 'createTemp', group: 3, label: _t("Create temporary folder"), show: () => isZone(), items: () => [it(_t("Create temporary folder"), 'folder-plus', () => p.promptNewGroup())] },
      { id: 'moveToTemp', group: 3, label: _t("Move to temporary folder…"), show: () => { const z = zone(); return !!(z && rootSel.length && z.items.some((i) => i.group)); },
        items: () => [it(_t("Move to temporary folder…"), 'folder-input', () => p.groupPickMenu(e, rootSel))] },
      { id: 'moveOutTemp', group: 3, label: _t("Move out of temporary folder"), show: () => { const z = zone(); return !!(z && rootSel.length && rootSel.some((f) => p.zoneGroupOf(f.path))); },
        items: () => [it(_t("Move out of temporary folder"), 'folder-output', () => p.zoneMoveToGroup(rootSel, null))] },
      { id: 'copy', group: 4, label: _t("Copy"), show: () => true, items: () => [it(_t("Copy"), 'copy', () => p.copySelection(pane, false))] },
      { id: 'cut', group: 4, label: _t("Cut"), show: () => true, items: () => [it(_t("Cut"), 'scissors', () => p.copySelection(pane, true))] },
      { id: 'paste', group: 4, label: _t("Paste"), show: () => true, items: () => [it(_t("Paste"), 'clipboard-paste', () => p.paste(pane.pasteTarget()))] },
      { id: 'copyPath', group: 5, label: _t("Copy path"), show: () => true, items: () => [it(_t("Copy path"), 'link', () => p.copyPaths(sel, false))] },
      { id: 'copyName', group: 5, label: _t("Copy names"), show: () => true, items: () => [it(_t("Copy names"), 'copy', () => p.copyNames(sel))] },
      { id: 'copyFullPath', group: 5, label: _t("Copy full path"), show: () => true, items: () => [it(_t("Copy full path"), 'link-2', () => p.copyPaths(sel, true))] },
      { id: 'bookmark', group: 5, label: _t("Add / remove bookmark"), show: () => !!p.getBookmarks(),
        items: () => [it(sel.every((f) => p.findBookmark(f.path)) ? _t("Remove bookmark") : _t("Add bookmark"), 'bookmark', () => p.toggleBookmarks(sel))] },
      { id: 'rename', group: 6, label: _t("Rename"), show: () => true, items: () => [it(_t("Rename"), 'pencil', () => pane.startRenameByPath(file.path))] },
      { id: 'batchRename', group: 6, label: _t("Batch rename…"), show: () => true, items: () => [it(_t("Batch rename… ({0})", sel.length), 'files', () => new BatchRenameModal(p.app, p, sel).open())] },
      { id: 'batchRenameInner', group: 6, label: _t("Batch rename files inside folder…"), show: () => isFolder(),
        items: () => [it(_t("Batch rename files inside folder…"), 'files', () => {
          const inner = p.getChildren(file).filter((f) => f instanceof TFile);
          if (!inner.length) { new Notice(_t("This folder has no files")); return; }
          new BatchRenameModal(p.app, p, inner).open();
        })] },
      { id: 'yamlEdit', group: 6, label: _t("Batch edit YAML…"), show: () => p.collectMarkdown(sel).length > 0,
        items: () => [it(_t("Batch edit YAML…"), 'braces', () => new YamlEditModal(p.app, p, p.collectMarkdown(sel)).open())] },
      { id: 'moveByTags', group: 6, label: _t("Move files by tags…"), show: () => p.collectMarkdown(sel).length > 0,
        items: () => [it(_t("Move files by tags…"), 'tags', () => new MoveByTagsModal(p.app, p, p.collectMarkdown(sel)).open())] },
      { id: 'moveByYaml', group: 6, label: _t("Move files by YAML…"), show: () => p.collectMarkdown(sel).length > 0,
        items: () => [it(_t("Move files by YAML…"), 'folder-input', () => new MoveByYamlModal(p.app, p, p.collectMarkdown(sel)).open())] },
      { id: 'appearance', group: 7, label: _t("Appearance (icon / color)…"), show: () => true, items: () => [it(_t("Appearance (icon / color)…"), 'palette', () => new StyleModal(p.app, p, sel).open())] },
      { id: 'sortFolder', group: 7, label: _t("Sort this folder…"), show: () => isFolder() && p.settings.sortMode === 'manual', items: () => [it(_t("Sort this folder…"), 'arrow-up-down', () => p.sortFolderMenu(e, file))] },
      { id: 'pin', group: 7, label: _t("Pin to top"), show: () => true, items: () => [it(_t("Pin to top"), 'pin', () => p.pinTop(pane, sel))] },
      { id: 'unpin', group: 7, label: _t("Unpin"), show: () => sel.every((f) => pane.pinSet.has(f.path)), items: () => [it(_t("Unpin"), 'pin-off', () => p.unpin(pane, sel))] },
      { id: 'moveUp', group: 7, label: _t("Move up"), show: () => true, items: () => [it(_t("Move up"), 'arrow-up', () => p.moveItems(pane, sel, -1))] },
      { id: 'moveDown', group: 7, label: _t("Move down"), show: () => true, items: () => [it(_t("Move down"), 'arrow-down', () => p.moveItems(pane, sel, 1))] },
      { id: 'outdent', group: 7, label: _t("Move up one level"), show: () => true, items: () => [it(_t("Move up one level"), 'corner-left-up', () => p.outdent(sel))] },
      { id: 'indent', group: 7, label: _t("Move down one level (into the previous folder)"), show: () => true, items: () => [it(_t("Move down one level (into the previous folder)"), 'corner-right-down', () => p.indent(sel))] },
      { id: 'hideExclude', group: 7, label: _t("Hide / unhide (exclude)"), show: () => !!(pane && !pane.cfg.isZone),
        items: () => [it(sel.every((f) => p.isExcluded(f.path)) ? _t("Unhide (remove exclusion)") : _t("Hide (add exclusion)"), 'eye-off', () => p.toggleExcluded(sel))] },
      { id: 'selectAllVisible', group: 8, label: _t("Select all (visible)"), show: () => true, items: () => [it(_t("Select all (visible)"), 'check-square', () => pane.selectAll())] },
      { id: 'selectAllAll', group: 8, label: _t("Select all (including collapsed)"), show: () => true, items: () => [it(_t("Select all (including collapsed)"), 'check-check', () => pane.selectEverything())] },
      { id: 'newNote', group: 9, label: _t("New note here"), show: () => isFolder(), items: () => [it(_t("New note here"), 'file-plus', () => p.promptCreate(file, 'note'))] },
      { id: 'newFolder', group: 9, label: _t("New folder here"), show: () => isFolder(), items: () => [it(_t("New folder here"), 'folder-plus', () => p.promptCreate(file, 'folder'))] },
      { id: 'newTyped', group: 9, label: _t("New other file types here (Base, Canvas…)"), show: () => isFolder(),
        items: () => p.newFileDefs().map((d) => it(_t("New {0} here", _t(d.label)), d.icon || 'file-plus', () => p.promptCreate(file, d))) },
      { id: 'dailyNote', group: 9, label: _t("Create daily note from template"), show: () => isFolder(), items: () => [it(_t("Create daily note from template"), 'calendar-plus', () => p.dailyMenu(e, file))] },
      { id: 'batchCreate', group: 9, label: _t("Batch create…"), show: () => isFolder(), items: () => [it(_t("Batch create…"), 'copy-plus', () => new BatchCreateModal(p.app, p, file).open())] },
      { id: 'properties', group: 10, label: _t("Properties…"), show: () => true, items: () => [it(_t("Properties…"), 'info', () => new PropertiesModal(p.app, p, sel).open())] },
      { id: 'delete', group: 10, label: _t("Delete"), show: () => true, items: () => [it(_t("Delete"), 'trash', () => p.deleteFiles(sel))] },
    ];
  }

  /* ---- 標籤／屬性管理：資料 ---- */
  invalidateMeta() { this._tagCache = null; this._propCache = null; this._propValCache = null; this._assigned = null; }
  refreshPanels() {
    this.views.forEach((v) => { if (v.refreshPanel) v.refreshPanel(); });
    [VIEW_TAGS, VIEW_PROPS].forEach((type) => this.app.workspace.getLeavesOfType(type).forEach((l) => { if (l.view && l.view.panel) l.view.panel.render(); }));
  }
  async setLeftMode(mode) {
    const s = this.settings;
    s.leftMode = mode;
    if (mode !== 'files' && s.layoutMode === 'zone') s.layoutMode = 'both';
    await this.saveSettings();
    this.refreshAll();
  }
  async openManagerTab(kind) {
    const ws = this.app.workspace, type = kind === 'tags' ? VIEW_TAGS : VIEW_PROPS;
    const existing = ws.getLeavesOfType(type)[0];
    if (existing) { ws.revealLeaf(existing); return; }
    const leaf = ws.getLeaf('tab');
    await leaf.setViewState({ type, active: true });
    ws.revealLeaf(leaf);
  }
  tagMetaW(tag) {
    if (!this.settings.tagMeta) this.settings.tagMeta = {};
    return this.settings.tagMeta[tag] || (this.settings.tagMeta[tag] = {});
  }
  tagData() {
    if (this._tagCache) return this._tagCache;
    const out = new Map(), map = new Map(), mc = this.app.metadataCache;
    for (const f of this.app.vault.getMarkdownFiles()) {
      const cache = mc.getFileCache(f);
      if (!cache) continue;
      const set = new Set((getAllTags(cache) || []).map((t) => t.replace(/^#/, '')));
      map.set(f.path, set);
      set.forEach((t) => {
        const e = out.get(t) || { count: 0, files: new Set(), mtime: 0 };
        e.count++; e.files.add(f.path); e.mtime = Math.max(e.mtime, f.stat.mtime);
        out.set(t, e);
      });
    }
    if (!this.fileTagMap) this.fileTagMap = map;
    (this.settings.tagCustom || []).forEach((t) => { if (!out.has(t)) out.set(t, { count: 0, files: new Set(), mtime: 0 }); });
    this._tagCache = out;
    return out;
  }
  // 筆記的標籤有新增時，更新該標籤的「上次使用」時間
  onMetaChanged(file) {
    if (!(file instanceof TFile) || file.extension !== 'md' || !this.fileTagMap) { this.requestPanels(); return; }
    const cache = this.app.metadataCache.getFileCache(file);
    const now = new Set(((cache && getAllTags(cache)) || []).map((t) => t.replace(/^#/, '')));
    const prev = this.fileTagMap.get(file.path) || new Set();
    let touched = false;
    now.forEach((t) => { if (!prev.has(t)) { this.tagMetaW(t).lastUsed = Date.now(); touched = true; } });
    this.fileTagMap.set(file.path, now);
    if (touched) this.saveSoon();
    this.requestPanels();
  }
  tagsUnder(tag) { return [...this.tagData().keys()].filter((t) => t === tag || t.startsWith(tag + '/')); }
  guardLocked(tags) {
    const meta = this.settings.tagMeta || {};
    for (const t of tags) {
      for (const u of [t, ...this.tagsUnder(t)]) {
        if (meta[u] && meta[u].locked) { new Notice(_t("Tag #{0} is locked and cannot be renamed, deleted or merged", u)); return true; }
      }
    }
    return false;
  }
  async toggleTagLock(tags) {
    const meta = this.settings.tagMeta || {};
    const all = tags.every((t) => meta[t] && meta[t].locked);
    tags.forEach((t) => { this.tagMetaW(t).locked = !all; });
    await this.saveSettings();
    this.refreshPanels();
  }
  setTagNote(tag, note) { this.tagMetaW(tag).note = note; this.saveSoon(); }
  validTagName(n) { return /^[^\s#]+$/.test(n) && !/^\/|\/$|\/\//.test(n); }
  // 依規則處理所有筆記中的標籤（正文與 frontmatter）。fn(tag) → { kind: keep|rename|unhash|remove, to? }
  async transformTags(fn) {
    const vault = this.app.vault, mc = this.app.metadataCache;
    let changed = 0;
    for (const f of vault.getMarkdownFiles()) {
      const cache = mc.getFileCache(f);
      if (!cache) continue;
      const inline = (cache.tags || []).map((t) => ({ t, act: fn(t.tag.replace(/^#/, '')) })).filter((x) => x.act && x.act.kind !== 'keep');
      if (inline.length) {
        let text = await vault.read(f);
        inline.sort((a, b) => b.t.position.start.offset - a.t.position.start.offset);
        for (const { t, act } of inline) {
          const s0 = t.position.start.offset, e0 = t.position.end.offset;
          if (act.kind === 'remove') {
            const cut = s0 > 0 && text[s0 - 1] === ' ' && (e0 >= text.length || /\s/.test(text[e0])) ? s0 - 1 : s0;
            text = text.slice(0, cut) + text.slice(e0);
          } else {
            const rep = act.kind === 'rename' ? '#' + act.to : t.tag.replace(/^#/, '');
            text = text.slice(0, s0) + rep + text.slice(e0);
          }
        }
        await vault.modify(f, text);
        changed++;
      }
      const fm = cache.frontmatter;
      const raw = fm && (fm.tags !== undefined ? fm.tags : fm.tag);
      if (raw !== undefined && raw !== null) {
        const list = (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/)).map((x) => String(x).replace(/^#/, '')).filter(Boolean);
        const acts = list.map((x) => ({ x, act: fn(x) }));
        if (acts.some((a) => a.act && a.act.kind !== 'keep')) {
          await this.app.fileManager.processFrontMatter(f, (m) => {
            const key = m.tags !== undefined ? 'tags' : 'tag';
            const out = [];
            acts.forEach(({ x, act }) => { const v = !act || act.kind === 'keep' ? x : act.kind === 'rename' ? act.to : null; if (v && !out.includes(v)) out.push(v); });
            if (out.length) m[key] = out; else delete m[key];
          });
          changed++;
        }
      }
    }
    return changed;
  }
  remapTagKeys(oldTag, newTag) {
    const s = this.settings;
    const map = (t) => (t === oldTag ? newTag : t.startsWith(oldTag + '/') ? newTag + t.slice(oldTag.length) : t);
    const meta = {};
    Object.entries(s.tagMeta || {}).forEach(([k, v]) => { const nk = map(k); if (!meta[nk]) meta[nk] = v; });
    s.tagMeta = meta;
    (s.tagFolders || []).forEach((f) => { f.tags = [...new Set((f.tags || []).map(map))]; });
    s.tagOrder = [...new Set((s.tagOrder || []).map(map))];
    s.tagCustom = [...new Set((s.tagCustom || []).map(map))];
  }
  dropTagKeys(tag, moveTo) {
    const s = this.settings;
    const under = (t) => t === tag || t.startsWith(tag + '/');
    Object.keys(s.tagMeta || {}).forEach((k) => {
      if (!under(k)) return;
      if (moveTo) { const nk = moveTo + k.slice(tag.length); if (!s.tagMeta[nk]) s.tagMeta[nk] = s.tagMeta[k]; }
      delete s.tagMeta[k];
    });
    (s.tagFolders || []).forEach((f) => { f.tags = (f.tags || []).filter((t) => !under(t)); });
    s.tagOrder = (s.tagOrder || []).filter((t) => !under(t));
    s.tagCustom = (s.tagCustom || []).filter((t) => !under(t));
  }
  async finishMetaOp(n) {
    await this.saveSettings();
    this.invalidateMeta();
    new Notice(_t("Updated {0} files", n));
    this.refreshPanels();
    setTimeout(() => this.requestPanels(), 800);
  }
  async renameTag(oldTag, newTag) {
    newTag = String(newTag).trim().replace(/^#/, '');
    if (!this.validTagName(newTag)) { new Notice(_t("Invalid tag name (it cannot contain spaces or #)")); return; }
    if (this.guardLocked([oldTag])) return;
    const n = await this.transformTags((t) => (t === oldTag || t.startsWith(oldTag + '/') ? { kind: 'rename', to: newTag + t.slice(oldTag.length) } : { kind: 'keep' }));
    this.remapTagKeys(oldTag, newTag);
    await this.finishMetaOp(n);
  }
  async mergeTags(sources, target, mode) {
    target = String(target || '').trim().replace(/^#/, '');
    if (mode === 'replace' && !this.validTagName(target)) { new Notice(_t("Invalid tag name (it cannot contain spaces or #)")); return; }
    if (this.guardLocked(sources)) return;
    const n = await this.transformTags((t) => {
      const src = sources.find((x) => t === x || t.startsWith(x + '/'));
      if (!src) return { kind: 'keep' };
      if (mode === 'replace') return { kind: 'rename', to: target + t.slice(src.length) };
      return { kind: mode === 'unhash' ? 'unhash' : 'remove' };
    });
    sources.forEach((x) => this.dropTagKeys(x, mode === 'replace' ? target : null));
    await this.finishMetaOp(n);
  }
  async deleteTags(tags, mode) {
    if (this.guardLocked(tags)) return;
    const n = await this.transformTags((t) => (tags.some((x) => t === x || t.startsWith(x + '/')) ? { kind: mode === 'hash' ? 'unhash' : 'remove' } : { kind: 'keep' }));
    tags.forEach((x) => this.dropTagKeys(x, null));
    await this.finishMetaOp(n);
  }
  promptNewTag() {
    new TextPromptModal(this.app, _t("Create tag"), '', async (name) => {
      const t2 = name.replace(/^#/, '').trim();
      if (!this.validTagName(t2)) { new Notice(_t("Invalid tag name (it cannot contain spaces or #)")); return; }
      const s = this.settings;
      if (!(s.tagCustom || []).includes(t2)) s.tagCustom = [...(s.tagCustom || []), t2];
      await this.saveSettings(); this.invalidateMeta(); this.refreshPanels();
    }).open();
  }
  openSearch(query) {
    try {
      const ip = this.app.internalPlugins;
      const gs = ip.getEnabledPluginById ? ip.getEnabledPluginById('global-search') : null;
      if (!gs || !gs.openGlobalSearch) { new Notice(_t("The core Search plugin is not available")); return; }
      gs.openGlobalSearch(query);
    } catch (e) { new Notice(_t("The core Search plugin is not available")); }
  }
  tagQuery(terms) { return terms.map((t) => (t.neg ? '-' : '') + 'tag:#' + t.tag).join(' '); }
  searchTags(terms) { this.openSearch(this.tagQuery(terms)); }
  addTagTerms(tags, neg) {
    tags.forEach((t) => { if (!this.tagTerms.some((x) => x.tag === t && x.neg === neg)) this.tagTerms.push({ tag: t, neg }); });
    new Notice(_t("Search condition added ({0} in total)", this.tagTerms.length));
  }
  searchProps(names) { this.openSearch(names.map((n) => `[${n}]`).join(' ')); }

  /* ---- 標籤：文件夾與手動排序 ---- */
  expandTagsFor(tags) {
    const all = [...this.tagData().keys()], out = new Set();
    tags.forEach((t) => all.forEach((x) => { if (x === t || x.startsWith(t + '/')) out.add(x); }));
    return [...out];
  }
  promptNewTagFolder(tags) {
    new TextPromptModal(this.app, _t("Create folder"), '', async (name) => {
      const s = this.settings;
      const real = this.expandTagsFor(tags || []);
      s.tagFolders = (s.tagFolders || []).map((f) => Object.assign(f, { tags: (f.tags || []).filter((t) => !real.includes(t)) }));
      s.tagFolders.push({ id: uid(), name, tags: real });
      await this.saveSettings(); this.refreshPanels();
    }).open();
  }
  async tagToFolder(tags, id) {
    const s = this.settings, real = this.expandTagsFor(tags);
    (s.tagFolders || []).forEach((f) => { f.tags = (f.tags || []).filter((t) => !real.includes(t)); });
    if (id) { const f = (s.tagFolders || []).find((x) => x.id === id); if (f) real.forEach((t) => { if (!f.tags.includes(t)) f.tags.push(t); }); }
    await this.saveSettings(); this.refreshPanels();
  }
  async renameTagFolder(id, name) { const f = (this.settings.tagFolders || []).find((x) => x.id === id); if (f) { f.name = name; await this.saveSettings(); this.refreshPanels(); } }
  async deleteTagFolder(id) { this.settings.tagFolders = (this.settings.tagFolders || []).filter((x) => x.id !== id); await this.saveSettings(); this.refreshPanels(); }
  panelOrder(panel, tags, field) {
    const s = this.settings;
    const visible = panel.rows.filter((r) => r.type === (field === 'tagOrder' ? 'tag' : 'prop')).map((r) => r.path);
    const rest = (s[field] || []).filter((t) => !visible.includes(t));
    return { visible, rest };
  }
  async tagReorder(panel, drag, targetPath, pos) {
    const s = this.settings, { visible, rest } = this.panelOrder(panel, drag, 'tagOrder');
    const moving = drag.filter((d) => visible.includes(d));
    let list = visible.filter((t) => !moving.includes(t));
    let idx = list.indexOf(targetPath);
    if (idx < 0) idx = list.length; else if (pos === 'after') idx++;
    list.splice(idx, 0, ...moving);
    s.tagOrder = [...list, ...rest];
    panel.cfg().sort = 'manual';
    await this.saveSettings(); this.refreshPanels();
  }
  async tagMove(panel, tags, dir) {
    const s = this.settings, { visible, rest } = this.panelOrder(panel, tags, 'tagOrder');
    const set = new Set(tags);
    s.tagOrder = [...shiftSelected(visible, (x) => set.has(x), dir), ...rest];
    panel.cfg().sort = 'manual';
    await this.saveSettings(); this.refreshPanels();
  }
  tagOutdent(tags) { return this.tagToFolder(tags, null); }
  async tagIndent(panel, tags) {
    const s = this.settings;
    const idx = panel.rows.findIndex((r) => r.type === 'tag' && tags.includes(r.path));
    if (idx < 0) return;
    const own = (s.tagFolders || []).find((f) => (f.tags || []).includes(panel.rows[idx].path));
    for (let i = idx - 1; i >= 0; i--) {
      const r = panel.rows[i];
      if (r.type === 'folder' && (!own || r.id !== own.id)) { await this.tagToFolder(tags, r.id); return; }
    }
    new Notice(_t("There is no folder above to move it into"));
  }

  /* ---- 屬性：資料 ---- */
  tagFilesOf(tag) {
    const data = this.tagData(), seen = new Set(), out = [];
    this.tagsUnder(tag).forEach((x) => {
      const d = data.get(x);
      if (d) d.files.forEach((path) => { if (!seen.has(path)) { seen.add(path); const f = this.app.vault.getAbstractFileByPath(path); if (f instanceof TFile) out.push(f); } });
    });
    return out.sort((a, b) => yamlCmp(a.basename, b.basename));
  }
  async toggleTagFiles(tags) {
    const s = this.settings;
    if (!s.tagFilesOpen) s.tagFilesOpen = {};
    const all = tags.every((x) => s.tagFilesOpen[x]);
    tags.forEach((x) => { if (all) delete s.tagFilesOpen[x]; else s.tagFilesOpen[x] = true; });
    await this.saveSettings(); this.refreshPanels();
  }
  // 手動排序下：依指定方式重新排列某個資料夾（可含所有子資料夾），結果寫入手動排序
  sortFolderMenu(e, folder) {
    const m = new Menu();
    const modes = ['name-asc', 'name-desc', 'mtime-desc', 'mtime-asc', 'ctime-desc', 'ctime-asc'];
    modes.forEach((k) => m.addItem((i) => i.setTitle(_t(SORT_MODES[k])).setIcon('arrow-up-down').onClick(() => this.applySortToFolder(folder, k, false))));
    m.addSeparator();
    modes.forEach((k) => m.addItem((i) => i.setTitle(_t("{0} (including all subfolders)", _t(SORT_MODES[k]))).setIcon('folder-tree').onClick(() => this.applySortToFolder(folder, k, true))));
    m.showAtMouseEvent(e);
  }
  async applySortToFolder(folder, mode, recursive) {
    const s = this.settings, prev = s.sortMode;
    const one = (f) => {
      s.sortMode = mode;
      const names = this.getChildren(f).map((c) => c.name);
      s.sortMode = prev;
      s.manualOrder[f.path] = names;
      if (recursive) f.children.forEach((c) => { if (c instanceof TFolder) one(c); });
    };
    one(folder);
    s.sortMode = 'manual';
    await this.saveSettings(); this.refreshAll();
    new Notice(_t('Sorted "{0}"', folder.isRoot() ? this.app.vault.getName() : folder.name));
  }
  async copyNames(files) {
    const list = files.map((f) => f.name);
    try { await navigator.clipboard.writeText(list.join('\n')); new Notice(_t("Copied {0} names", list.length)); } catch (e) { new Notice(_t("Copy failed")); }
  }
  // 屬性的「指定類型」（例如 datetime）：優先使用 Obsidian 的類型設定，再退回 types.json
  assignedPropType(name) {
    const k = String(name).toLowerCase();
    if (this._typeOverride && this._typeOverride[k]) return this._typeOverride[k];
    const mtm = this.app.metadataTypeManager;
    if (!this._assigned) {
      this._assigned = {};
      try {
        const ty = mtm && (mtm.types || mtm.typeCache || mtm.propertyTypes);
        if (ty && typeof ty === 'object') Object.entries(ty).forEach(([n, v]) => { const x = typeof v === 'string' ? v : v && (v.type || v.widget); if (x) this._assigned[n.toLowerCase()] = x; });
      } catch (e) { /* ignore */ }
      if (this._typesFile) Object.entries(this._typesFile).forEach(([n, v]) => { if (v && !this._assigned[n.toLowerCase()]) this._assigned[n.toLowerCase()] = v; });
    }
    if (this._assigned[k]) return this._assigned[k];
    try { if (mtm && mtm.getAssignedWidget) { const w = mtm.getAssignedWidget(name); if (w) return w; } } catch (e) { /* ignore */ }
    if (this._typesFile === undefined) this.loadTypesFile();
    return null;
  }
  async loadTypesFile() {
    if (this._typesFile === undefined) this._typesFile = {};
    try {
      const path = (this.app.vault.configDir || '.obsidian') + '/types.json';
      if (await this.app.vault.adapter.exists(path)) {
        const data = JSON.parse(await this.app.vault.adapter.read(path));
        this._typesFile = (data && data.types) || {};
        // 檔案已經寫入的類型，不再需要暫時覆蓋
        Object.entries(this._typeOverride || {}).forEach(([k, v]) => {
          const hit = Object.entries(this._typesFile).find(([n]) => n.toLowerCase() === k);
          if (hit && hit[1] === v) delete this._typeOverride[k];
        });
        this._assigned = null; this._propCache = null;
        this.refreshPanels();
      }
    } catch (e) { /* ignore */ }
  }
  propData() {
    if (this._propCache) return this._propCache;
    const out = new Map();
    try {
      const info = this.app.metadataCache.getAllPropertyInfos ? this.app.metadataCache.getAllPropertyInfos() : null;
      Object.values(info || {}).forEach((x) => { if (x && x.name) out.set(x.name, { name: x.name, type: this.assignedPropType(x.name) || x.type || 'text', count: x.count || 0 }); });
    } catch (e) { /* ignore */ }
    if (!out.size) {
      for (const f of this.app.vault.getMarkdownFiles()) {
        const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter;
        if (!fm) continue;
        Object.keys(fm).filter((k) => k !== 'position').forEach((k) => { const e = out.get(k) || { name: k, type: this.assignedPropType(k) || (Array.isArray(fm[k]) ? 'multitext' : 'text'), count: 0 }; e.count++; out.set(k, e); });
      }
    }
    (this.settings.propCustom || []).forEach((n) => { if (!out.has(n)) out.set(n, { name: n, type: this.assignedPropType(n) || 'text', count: 0 }); });
    this._propCache = out;
    return out;
  }
  propValues(name) {
    if (!this._propValCache) this._propValCache = new Map();
    if (this._propValCache.has(name)) return this._propValCache.get(name);
    const counts = new Map();
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter;
      if (!fm || !yamlHas(fm, name)) continue;
      (Array.isArray(fm[name]) ? fm[name] : [fm[name]]).forEach((x) => { if (x !== null && x !== undefined && typeof x !== 'object') counts.set(String(x), (counts.get(String(x)) || 0) + 1); });
    }
    const out = [...counts.entries()].sort((a, b) => b[1] - a[1] || yamlCmp(a[0], b[0]));
    this._propValCache.set(name, out);
    return out;
  }
  async editFrontmatterOf(pred, edit) {
    let n = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter;
      if (!fm || !pred(fm)) continue;
      try { await this.app.fileManager.processFrontMatter(f, edit); n++; } catch (e) { console.error(e); }
    }
    return n;
  }
  async setPropType(names, type) {
    const mtm = this.app.metadataTypeManager;
    const fn = mtm && (mtm.setType || mtm.setPropertyType);
    if (!fn) { new Notice(_t("This version of Obsidian does not support setting property types from a plugin")); return; }
    for (const n of names) { try { await fn.call(mtm, n, type); } catch (e) { console.error(e); } }
    if (!this._typeOverride) this._typeOverride = {};
    names.forEach((n) => { this._typeOverride[String(n).toLowerCase()] = type; });
    this.invalidateMeta(); this.refreshPanels();
    setTimeout(() => this.loadTypesFile(), 800);
    new Notice(_t("Set the type of {0} properties", names.length));
  }
  async renameProps(map) {
    const s = this.settings;
    let total = 0;
    for (const [oldN, newN] of Object.entries(map)) {
      const type = (this.propData().get(oldN) || {}).type;
      total += await this.editFrontmatterOf((fm) => yamlHas(fm, oldN), (fm) => {
        if (yamlHas(fm, newN)) { delete fm[oldN]; return; }
        const out = {};
        Object.entries(fm).forEach(([k, v]) => { out[k === oldN ? newN : k] = v; });
        Object.keys(fm).forEach((k) => { delete fm[k]; });
        Object.assign(fm, out);
      });
      if (type && type !== 'text') await this.setPropType([newN], type);
      (s.propFolders || []).forEach((f) => { f.props = [...new Set((f.props || []).map((x) => (x === oldN ? newN : x)))]; });
      s.propOrder = [...new Set((s.propOrder || []).map((x) => (x === oldN ? newN : x)))];
      s.propCustom = [...new Set((s.propCustom || []).map((x) => (x === oldN ? newN : x)))];
    }
    await this.finishMetaOp(total);
  }
  async deleteProps(names) {
    const s = this.settings;
    let total = 0;
    for (const n of names) {
      total += await this.editFrontmatterOf((fm) => yamlHas(fm, n), (fm) => { delete fm[n]; });
      (s.propFolders || []).forEach((f) => { f.props = (f.props || []).filter((x) => x !== n); });
      s.propOrder = (s.propOrder || []).filter((x) => x !== n);
      s.propCustom = (s.propCustom || []).filter((x) => x !== n);
    }
    await this.finishMetaOp(total);
  }
  async renamePropValue(prop, oldV, newV) {
    newV = String(newV).trim();
    if (!newV || newV === oldV) return;
    const n = await this.editFrontmatterOf((fm) => yamlHas(fm, prop) && (Array.isArray(fm[prop]) ? fm[prop] : [fm[prop]]).map(String).includes(oldV), (fm) => {
      const cur = Array.isArray(fm[prop]) ? fm[prop] : [fm[prop]];
      const out = [];
      cur.forEach((x) => { const v = String(x) === oldV ? newV : x; if (!out.some((y) => String(y) === String(v))) out.push(v); });
      fm[prop] = Array.isArray(fm[prop]) ? out : out[0];
    });
    await this.finishMetaOp(n);
  }
  async deletePropValue(prop, value) {
    const n = await this.editFrontmatterOf((fm) => yamlHas(fm, prop) && (Array.isArray(fm[prop]) ? fm[prop] : [fm[prop]]).map(String).includes(value), (fm) => {
      if (Array.isArray(fm[prop])) fm[prop] = fm[prop].filter((x) => String(x) !== value);
      else delete fm[prop];
    });
    await this.finishMetaOp(n);
  }
  async addPropValues(props, values) {
    let total = 0;
    for (const prop of props) {
      total += await this.editFrontmatterOf((fm) => yamlHas(fm, prop), (fm) => {
        const cur = Array.isArray(fm[prop]) ? [...fm[prop]] : fm[prop] === null || fm[prop] === undefined || fm[prop] === '' ? [] : [fm[prop]];
        values.forEach((v) => { if (!cur.some((x) => String(x) === v)) cur.push(v); });
        fm[prop] = cur;
      });
    }
    await this.finishMetaOp(total);
  }
  async createProp(name, type) {
    const s = this.settings;
    if (!(s.propCustom || []).includes(name)) s.propCustom = [...(s.propCustom || []), name];
    await this.saveSettings();
    if (type !== 'text') await this.setPropType([name], type);
    this.invalidateMeta(); this.refreshPanels();
  }
  promptNewPropFolder(props) {
    new TextPromptModal(this.app, _t("Create folder"), '', async (name) => {
      const s = this.settings, list = props || [];
      s.propFolders = (s.propFolders || []).map((f) => Object.assign(f, { props: (f.props || []).filter((x) => !list.includes(x)) }));
      s.propFolders.push({ id: uid(), name, props: [...list] });
      await this.saveSettings(); this.refreshPanels();
    }).open();
  }
  async propToFolder(props, id) {
    const s = this.settings;
    (s.propFolders || []).forEach((f) => { f.props = (f.props || []).filter((x) => !props.includes(x)); });
    if (id) { const f = (s.propFolders || []).find((x) => (x.id || x.name) === id); if (f) props.forEach((n) => { if (!f.props.includes(n)) f.props.push(n); }); }
    await this.saveSettings(); this.refreshPanels();
  }
  async deletePropFolder(id) { this.settings.propFolders = (this.settings.propFolders || []).filter((x) => (x.id || x.name) !== id); await this.saveSettings(); this.refreshPanels(); }
  async propReorder(panel, drag, targetPath, pos) {
    const s = this.settings, { visible, rest } = this.panelOrder(panel, drag, 'propOrder');
    const moving = drag.filter((d) => visible.includes(d));
    const list = visible.filter((t) => !moving.includes(t));
    let idx = list.indexOf(targetPath);
    if (idx < 0) idx = list.length; else if (pos === 'after') idx++;
    list.splice(idx, 0, ...moving);
    s.propOrder = [...list, ...rest];
    panel.cfg().sort = 'manual';
    await this.saveSettings(); this.refreshPanels();
  }
  async propMove(panel, props, dir) {
    const s = this.settings, { visible, rest } = this.panelOrder(panel, props, 'propOrder');
    const set = new Set(props);
    s.propOrder = [...shiftSelected(visible, (x) => set.has(x), dir), ...rest];
    panel.cfg().sort = 'manual';
    await this.saveSettings(); this.refreshPanels();
  }
  async propIndent(panel, props) {
    const s = this.settings;
    const idx = panel.rows.findIndex((r) => r.type === 'prop' && props.includes(r.path));
    if (idx < 0) return;
    const own = (s.propFolders || []).find((f) => (f.props || []).includes(panel.rows[idx].path));
    for (let i = idx - 1; i >= 0; i--) {
      const r = panel.rows[i];
      if (r.type === 'folder' && (!own || r.id !== (own.id || own.name))) { await this.propToFolder(props, r.id); return; }
    }
    new Notice(_t("There is no folder above to move it into"));
  }
  folderPaths() {
    const out = ['/'];
    const walk = (f) => f.children.forEach((c) => { if (c instanceof TFolder) { out.push(c.path); walk(c); } });
    walk(this.app.vault.getRoot());
    return out;
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
    // 重新繪製時記住捲動位置，避免跳回最上面
    const scroller = el.closest ? el.closest('.vertical-tab-content') || el.parentElement : null;
    const keepTop = this.shown && scroller ? scroller.scrollTop : 0;
    this.shown = true;
    el.empty();
    const searchWrap = el.createDiv({ cls: 'ffm-settings-search-wrap' });
    const search = searchWrap.createEl('input', { type: 'search', cls: 'ffm-settings-search' });
    search.placeholder = _t("Search settings… (type # to jump to a section)");
    search.value = this.query || '';
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
    new Setting(el).setName(_t("Folder position")).setDesc(_t("Where folders go when sorting. \"Mixed by name\" sorts files and folders together; a folder whose name starts with a file's name (for example A-image and A.md) goes right before or after that file.")).addDropdown((d) => {
      [['top', 'Folders at the top'], ['bottom', 'Folders at the bottom'], ['mixed-before', 'Mixed by name: folder before its file'], ['mixed-after', 'Mixed by name: folder after its file']].forEach(([k, label]) => d.addOption(k, _t(label)));
      d.setValue(s.sortFolderPos || (s.sortFoldersFirst === false ? 'mixed-after' : 'top'));
      d.onChange(async (v) => { s.sortFolderPos = v; await save(); });
    });
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
    toggle(_t("Single click does not open files"), _t("When enabled, a single click only selects; open files with the open icons below (or the right-click menu)"), () => s.openViaButton, (v) => (s.openViaButton = v));
    new Setting(el).setName(_t("How files open")).setDesc(_t("Applies to single-click open, the right-click \"Open\" and the open icon"))
      .addDropdown((d) => {
        d.addOption('current', _t("Open in current tab")); d.addOption('tab', _t("Open in new tab"));
        d.setValue(s.openMode || 'current');
        d.onChange(async (v) => { s.openMode = v; await save(); });
      });
    toggle(_t("Show open icon"), _t("Show an \"Open\" icon beside each file (on by default)"), () => s.showOpenIcon !== false, (v) => (s.showOpenIcon = v));
    toggle(_t("Show \"open in new tab to the right\" icon"), _t("Show an \"open in new tab to the right\" icon beside each file (on by default). If \"How files open\" is set to new tab, only one icon is shown"), () => s.showTabButton !== false, (v) => (s.showTabButton = v));
    toggle(_t("Open icons follow the sidebar"), _t("The icons stay pinned to the right edge of the visible area, so long file names never push them out of the sidebar (on by default)"), () => s.openIconSticky !== false, (v) => (s.openIconSticky = v));
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
    toggle(_t("Highlight new items"), _t("After creating a note, folder, etc. from the menu, the new item's background is briefly highlighted (on by default)"), () => s.highlightNew !== false, (v) => (s.highlightNew = v));
    new Setting(el).setName(_t("Highlight color")).setDesc(_t("Leave empty to use the theme's accent color. Accepts color names, RGB or HEX"))
      .addText((t2) => t2.setPlaceholder(_t("Follow theme")).setValue(s.highlightColor || '').onChange(async (v) => { s.highlightColor = v.trim(); await save(); }))
      .addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip(_t("Reset (follow theme)")).onClick(async () => { s.highlightColor = ''; await save(); this.display(); }));
    toggle(_t("Locate new items"), _t("Automatically expands parent folders and scrolls to the new item (on by default)"), () => s.locateNew !== false, (v) => (s.locateNew = v));
    toggle(_t("Open in the left sidebar when the plugin is enabled"), _t("When you enable this plugin manually inside Obsidian, Focus File Manager opens in the left sidebar automatically (on by default)"), () => s.openOnEnable !== false, (v) => (s.openOnEnable = v));
    new Setting(el).setName(_t("Maximum for batch create")).setDesc(_t("The most items one batch create can make. Default 10, maximum 50"))
      .addSlider((sl) => sl.setLimits(1, 50, 1).setValue(Math.max(1, Math.min(50, Number(s.batchCreateMax) || 10))).setDynamicTooltip().onChange(async (v) => { s.batchCreateMax = v; await p.saveSettings(); }));
    toggle(_t("Show excluded files"), _t("Hidden by default. You can also toggle it with the eye button on the toolbar"), () => !!s.showExcluded, (v) => (s.showExcluded = v));
    new Setting(el).setName(_t("Exclusion list (hidden files / folders)")).setDesc(_t("One per line. Starting with / or containing / means a path (e.g. /Projects/Archive); otherwise it is a name (any item with that name). Wildcards * and ? work. \"Hide\" in the right-click menu writes here automatically"))
      .addTextArea((t2) => { t2.setPlaceholder('/Projects/Archive\n*.tmp').setValue(s.hiddenList || '').onChange(async (v) => { s.hiddenList = v; await save(); }); t2.inputEl.rows = 3; t2.inputEl.style.width = '100%'; });
    toggle(_t("Tags in notes: single click edits, double click searches"), _t("When on (default), a single click on a tag (#tag) in a note does not jump to Obsidian's search so you can edit it directly; a double click searches for the tag"), () => s.tagClickEdit !== false, (v) => (s.tagClickEdit = v));
    toggle(_t("Locate the file when clicking the file name under the tab bar"), _t("A single click on the file name locates and highlights the file in this plugin; a double click starts renaming (on by default)"), () => s.headerTitleLocate !== false, (v) => (s.headerTitleLocate = v));
    toggle(_t("Prefer this plugin when clicking the path under the tab bar"), _t("When you click a folder name in the path above a note's title, this plugin locates and shows that folder (on by default)"), () => s.headerPathPrefer !== false, (v) => (s.headerPathPrefer = v));

    heading(_t("Daily note templates"));
    new Setting(el).setName(_t("Daily note template paths")).setDesc(_t("One path per line; each can be a template file or a folder (every .md inside a folder is listed as a template). Supports {{date}}, {{date:FORMAT}}, {{time}} and {{title}}"))
      .addTextArea((t2) => { t2.setPlaceholder('Templates/Daily.md\nTemplates/Journal').setValue(s.dailyTemplates || '').onChange(async (v) => { s.dailyTemplates = v; await p.saveSettings(); }); t2.inputEl.rows = 3; t2.inputEl.style.width = '100%'; });
    new Setting(el).setName(_t("Daily note file name format")).setDesc(_t("Uses moment.js format tokens; default YYYY-MM-DD"))
      .addText((t2) => t2.setPlaceholder('YYYY-MM-DD').setValue(s.dailyNameFormat || 'YYYY-MM-DD').onChange(async (v) => { s.dailyNameFormat = v.trim() || 'YYYY-MM-DD'; await p.saveSettings(); }));

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

    heading(_t("Right-click menu"));
    new Setting(el).setDesc(_t("Reorder the items in the file and folder right-click menu, or turn off the ones you don't need (all on by default). The separator lines are listed too: move or remove them, or add your own"));
    const menuList = p.menuRegistry(null, {});
    let menuOrder = p.menuOrderList(menuList.map((x) => x.id));
    // 把目前選單裡自動產生的分組分隔線，轉成可以移動／移除的項目（只轉換一次）
    if (!s.menuSepExplicit) {
      const grp = new Map(menuList.map((x) => [x.id, x.group]));
      const out = [];
      let prevGroup = null;
      menuOrder.forEach((id) => {
        if (String(id).startsWith('sep:')) { out.push(id); prevGroup = null; return; }
        const g = grp.get(id);
        if (prevGroup !== null && g !== prevGroup) out.push('sep:' + uid());
        out.push(id);
        prevGroup = g;
      });
      s.menuOrder = out; s.menuSepExplicit = true; menuOrder = out;
      p.saveSettings();
    }
    const menuHidden = new Set(s.menuHidden);
    const menuIcons = s.menuIcons || (s.menuIcons = {});
    const iconOf = (id) => menuIcons[id] || MENU_ICONS[id] || 'circle';
    const moveMenu = (a, b) => async () => { const arr = [...menuOrder]; [arr[a], arr[b]] = [arr[b], arr[a]]; s.menuOrder = arr; await p.saveSettings(); this.display(); };
    menuOrder.forEach((id, idx) => {
      const isSep = String(id).startsWith('sep:');
      const en = isSep ? null : menuList.find((x) => x.id === id);
      if (!isSep && !en) return;
      const row = new Setting(el).setName(isSep ? '' : en.label);
      if (isSep) {
        row.settingEl.addClass('ffm-menu-sep-row');
        row.nameEl.setText('───── ' + _t("Separator") + ' ─────');
        row.addExtraButton((b) => b.setIcon('trash').setTooltip(_t("Remove separator")).onClick(async () => { s.menuOrder = menuOrder.filter((x, k) => k !== idx); await p.saveSettings(); this.display(); }));
      } else {
        const ico = row.nameEl.createSpan({ cls: 'ffm-menu-ico' });
        setIcon(ico, iconOf(id));
        row.nameEl.prepend(ico);
        row.addToggle((tg) => tg.setValue(!menuHidden.has(id)).onChange(async (v) => {
          s.menuHidden = v ? s.menuHidden.filter((x) => x !== id) : s.menuHidden.includes(id) ? s.menuHidden : [...s.menuHidden, id];
          await p.saveSettings();
        }));
        row.addExtraButton((b) => b.setIcon('image-plus').setTooltip(_t("Change icon")).onClick(() => new IconPickerModal(p.app, p, iconOf(id), async (v) => { menuIcons[id] = v; await p.saveSettings(); this.display(); }).open()));
        if (menuIcons[id]) row.addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip(_t("Reset icon")).onClick(async () => { delete menuIcons[id]; await p.saveSettings(); this.display(); }));
        row.addExtraButton((b) => b.setIcon('separator-horizontal').setTooltip(_t("Insert a separator below")).onClick(async () => { const arr = [...menuOrder]; arr.splice(idx + 1, 0, 'sep:' + uid()); s.menuOrder = arr; await p.saveSettings(); this.display(); }));
      }
      row.addExtraButton((b) => { b.setIcon('arrow-up').setTooltip(_t("Move up")).onClick(moveMenu(idx, idx - 1)); b.setDisabled(idx === 0); });
      row.addExtraButton((b) => { b.setIcon('arrow-down').setTooltip(_t("Move down")).onClick(moveMenu(idx, idx + 1)); b.setDisabled(idx === menuOrder.length - 1); });
    });
    new Setting(el).addButton((b) => b.setButtonText(_t("Add separator")).onClick(async () => { s.menuOrder = [...menuOrder, 'sep:' + uid()]; await p.saveSettings(); this.display(); }));
    new Setting(el).addButton((b) => b.setButtonText(_t("Restore default order and switches")).onClick(async () => { s.menuOrder = []; s.menuHidden = []; s.menuIcons = {}; s.menuSepExplicit = false; await p.saveSettings(); this.display(); }));

    heading(_t("Batch rename presets"));
    s.renamePresets.forEach((pr, idx) => {
      const card = el.createDiv({ cls: 'ffm-preset-card' });
      new Setting(card).setName(_t("Preset name")).addText((t) => t.setValue(_t(pr.name)).onChange(async (v) => { pr.name = v || _t("Untitled"); await p.saveSettings(); }))
        .addDropdown((d) => {
          d.addOption('pattern', _t("Name pattern / numbering")); d.addOption('replace', _t("Replace characters")); d.addOption('list', _t("List replace")); d.setValue(pr.type);
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
      } else if (pr.type === 'list') {
        new Setting(card).setName(_t("Name list")).setDesc(_t("One name per line, applied to the files in order"))
          .addTextArea((t2) => { t2.setValue(pr.names || '').onChange(async (v) => { pr.names = v; await p.saveSettings(); }); t2.inputEl.rows = 4; t2.inputEl.style.width = '100%'; });
      } else {
        text(_t("Find"), '', 'find'); text(_t("Replace with"), '', 'replace');
        tog(_t("Use regular expression"), 'regex'); tog(_t("Case sensitive"), 'caseSensitive');
      }
    });
    new Setting(el).addButton((b) => b.setButtonText(_t("Add preset")).onClick(async () => {
      s.renamePresets.push({ id: uid(), name: _t("New preset"), type: 'pattern', pattern: '{n} {name}', start: 1, step: 1, pad: 2, find: '', replace: '', regex: false, caseSensitive: true });
      await p.saveSettings(); this.display();
    }));

    // ---- 搜尋：依名稱與說明過濾；標題符合時顯示整個區段
    const hasCls = (c, n) => (c.classList ? c.classList.contains(n) : !!(c.classes && c.classes.has(n)));
    const textOf = (c) => {
      const info = c.querySelector ? c.querySelector('.setting-item-info') : null;
      const x = info || c;
      return String(x.textContent !== undefined ? x.textContent : x.text || '').toLowerCase();
    };
    const noMatch = el.createDiv({ cls: 'ffm-empty', text: _t("No matching settings") });
    noMatch.style.display = 'none';
    const toc = searchWrap.createDiv({ cls: 'ffm-settings-toc' });
    toc.style.display = 'none';
    const rawTextOf = (c) => {
      const info = c.querySelector ? c.querySelector('.setting-item-info') : null;
      const x = info || c;
      return String(x.textContent !== undefined ? x.textContent : x.text || '').trim();
    };
    // 輸入 # 時列出所有功能區塊，點擊即可跳轉
    const renderToc = (q) => {
      toc.empty();
      toc.style.display = '';
      const heads = [...el.children].filter((c) => c !== searchWrap && c !== noMatch && hasCls(c, 'setting-item-heading'));
      let shown = 0;
      heads.forEach((h) => {
        const label = rawTextOf(h);
        if (!label || (q && !label.toLowerCase().includes(q))) return;
        shown++;
        h.style.scrollMarginTop = '64px';
        const item = toc.createDiv({ cls: 'ffm-settings-toc-item', text: label });
        item.addEventListener('mousedown', (ev) => ev.preventDefault());
        item.addEventListener('click', () => {
          search.value = ''; this.query = ''; applyFilter();
          if (h.scrollIntoView) h.scrollIntoView({ block: 'start' });
        });
      });
      if (!shown) toc.createDiv({ cls: 'ffm-empty', text: _t("No matching sections") });
    };
    const applyFilter = () => {
      const raw = search.value.trim();
      if (raw.startsWith('#') || raw.startsWith('＃')) {
        renderToc(raw.slice(1).trim().toLowerCase());
        for (const c of [...el.children]) { if (c !== searchWrap && c !== noMatch) c.style.display = ''; }
        noMatch.style.display = 'none';
        return;
      }
      toc.style.display = 'none';
      const q = raw.toLowerCase();
      let heading = null, headingHit = false, sectionMatch = false, any = false;
      const flush = () => { if (heading) heading.style.display = !q || headingHit || sectionMatch ? '' : 'none'; };
      for (const c of [...el.children]) {
        if (c === searchWrap || c === noMatch) continue;
        if (hasCls(c, 'setting-item-heading')) {
          flush();
          heading = c; headingHit = false;
          sectionMatch = !!q && textOf(c).includes(q);
          continue;
        }
        const hit = !q || sectionMatch || textOf(c).includes(q);
        c.style.display = hit ? '' : 'none';
        if (hit) { headingHit = true; any = true; }
      }
      flush();
      if (sectionMatch) any = true;
      noMatch.style.display = q && !any ? '' : 'none';
    };
    search.addEventListener('input', () => { this.query = search.value; applyFilter(); });
    applyFilter();
    if (scroller && keepTop) {
      scroller.scrollTop = keepTop;
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { scroller.scrollTop = keepTop; });
    }
  }
  hide() {
    this.shown = false;
    this.query = '';
    if (super.hide) super.hide();
  }
}

module.exports = FocusFileManagerPlugin;
