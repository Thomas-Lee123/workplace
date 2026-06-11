import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

type Lang = 'zh' | 'en';

const TRANSLATIONS: Record<string, { zh: string; en: string }> = {
  // Common
  'common.loading': { zh: '加载中...', en: 'Loading...' },
  'common.back': { zh: '返回', en: 'Back' },
  'common.cancel': { zh: '取消', en: 'Cancel' },
  'common.send': { zh: '发送', en: 'Send' },
  'common.show': { zh: '显示', en: 'Show' },
  'common.hide': { zh: '隐藏', en: 'Hide' },
  'common.error': { zh: '错误', en: 'Error' },
  'common.failed': { zh: '失败', en: 'Failed' },

  // App
  'app.name': { zh: '一键旅行', en: 'One-Click Travel' },

  // Login
  'login.appName': { zh: '一键旅行', en: 'One-Click Travel' },
  'login.appSubtitle': { zh: '旅行行程"购物车"', en: 'Travel Itinerary Cart' },
  'login.signIn': { zh: '登录', en: 'Sign in' },
  'login.signUp': { zh: '注册', en: 'Sign up' },
  'login.name': { zh: '名字', en: 'Name' },
  'login.email': { zh: '邮箱', en: 'Email' },
  'login.password': { zh: '密码', en: 'Password' },
  'login.confirmPassword': { zh: '确认密码', en: 'Confirm password' },
  'login.passwordMismatch': { zh: '两次密码不一致', en: 'Passwords do not match' },

  // Sidebar
  'sidebar.trips': { zh: '行程', en: 'Trips' },
  'sidebar.tripName': { zh: '行程名称', en: 'Trip name' },
  'sidebar.destination': { zh: '目的地', en: 'Destination' },
  'sidebar.create': { zh: '创建', en: 'Create' },
  'sidebar.cancel': { zh: '取消', en: 'Cancel' },
  'sidebar.newTrip': { zh: '+ 新建行程', en: '+ New trip' },
  'sidebar.createManually': { zh: '手动创建', en: 'Create manually' },
  'sidebar.tools': { zh: '工具', en: 'Tools' },
  'sidebar.aiGenerate': { zh: 'AI 生成', en: 'AI Generate' },
  'sidebar.importTrip': { zh: '导入行程', en: 'Import trip' },
  'sidebar.logout': { zh: '退出登录', en: 'Log out' },
  'sidebar.empty': { zh: '选择行程或创建新行程', en: 'Select a trip or create a new one' },
  'sidebar.deleteConfirm': { zh: '确定删除此行程？', en: 'Delete this trip?' },

  // TripDetail
  'tripDetail.notFound': { zh: '行程未找到', en: 'Trip not found' },
  'tripDetail.addItem': { zh: '添加项目', en: 'Add item' },
  'tripDetail.exportXlsx': { zh: '导出 xlsx', en: 'Export xlsx' },
  'tripDetail.exportDoc': { zh: '导出 doc', en: 'Export doc' },
  'tripDetail.chat': { zh: '聊天', en: 'Chat' },
  'tripDetail.chatButton': { zh: '和 AI 讨论修改行程', en: 'Chat with AI' },
  'tripDetail.closeChat': { zh: '关闭聊天', en: 'Close chat' },
  'tripDetail.items': { zh: '项', en: 'items' },
  'tripDetail.budget': { zh: '预算', en: 'Budget' },
  'tripDetail.dropHere': { zh: '拖拽项目到此', en: 'Drop items here' },
  'tripDetail.dragToReorder': { zh: '拖拽排序', en: 'Drag to reorder' },
  'tripDetail.openSource': { zh: '打开来源', en: 'Open source' },
  'tripDetail.searchCtrip': { zh: '搜索携程', en: 'Search Ctrip' },
  'tripDetail.pasteLink': { zh: '粘贴链接...', en: 'Paste link...' },
  'tripDetail.analyzing': { zh: '分析中...', en: 'Analyzing...' },
  'tripDetail.analysis': { zh: '分析', en: 'Analysis' },
  'tripDetail.note': { zh: '备注...', en: 'Note...' },
  'tripDetail.subtitle': { zh: '副标题...', en: 'Subtitle...' },
  'tripDetail.deleteConfirm': { zh: '确定删除此项目？', en: 'Delete this item?' },
  'tripDetail.thinking': { zh: '思考中...', en: 'Thinking...' },
  'tripDetail.chatPlaceholder': { zh: '输入修改建议...', en: 'Ask to modify the trip...' },
  'tripDetail.pending': { zh: '待定', en: 'Pending' },
  'tripDetail.purchased': { zh: '已购', en: 'Purchased' },
  'tripDetail.cancelled': { zh: '取消', en: 'Cancelled' },
  'tripDetail.moveFailed': { zh: '移动失败', en: 'Move failed' },
  'tripDetail.exportFailed': { zh: '导出失败', en: 'Export failed' },
  'tripDetail.applied': { zh: '已应用', en: 'Applied' },

  // Types & sources
  'type.traffic': { zh: '交通', en: 'Traffic' },
  'type.hotel': { zh: '酒店', en: 'Hotel' },
  'type.attraction': { zh: '景点', en: 'Attraction' },
  'type.meal': { zh: '餐饮', en: 'Meal' },
  'type.custom': { zh: '其他', en: 'Other' },
  'source.ctrip': { zh: '携程', en: 'Ctrip' },
  'source.mafengwo': { zh: '马蜂窝', en: 'Mafengwo' },
  'source.fliggy': { zh: '飞猪', en: 'Fliggy' },
  'source.meituan': { zh: '美团', en: 'Meituan' },
  'source.qunar': { zh: '去哪儿', en: 'Qunar' },
  'source.manual': { zh: '手动', en: 'Manual' },
  'site.tongcheng': { zh: '同程', en: 'Tongcheng' },

  // AddItem
  'addItem.title': { zh: '添加项目', en: 'Add item' },
  'addItem.parseHint': { zh: '粘贴携程/马蜂窝链接，自动提取信息', en: 'Paste a Ctrip/Mafengwo link to auto-fill' },
  'addItem.parse': { zh: '解析', en: 'Parse' },
  'addItem.parsing': { zh: '解析中...', en: 'Parsing...' },
  'addItem.autoDetected': { zh: '已自动识别', en: 'Auto-detected' },
  'addItem.incomplete': { zh: '信息不完整，请手动补充', en: 'Incomplete info, please fill manually' },
  'addItem.formTitle': { zh: '项目名称', en: 'Title' },
  'addItem.formSubtitle': { zh: '副标题（房型/票种）', en: 'Subtitle' },
  'addItem.formType': { zh: '类型', en: 'Type' },
  'addItem.formPrice': { zh: '价格', en: 'Price' },
  'addItem.formDay': { zh: '归入哪一天', en: 'Day' },
  'addItem.formSource': { zh: '来源平台', en: 'Source' },
  'addItem.formSourceUrl': { zh: '商品链接', en: 'Source URL' },
  'addItem.formImageUrl': { zh: '图片链接', en: 'Image URL' },
  'addItem.formNote': { zh: '备注', en: 'Note' },
  'addItem.selectDay': { zh: '选择...', en: 'Select...' },
  'addItem.submit': { zh: '确认添加', en: 'Add item' },

  // AIGenerate
  'ai.title': { zh: 'AI 生成行程', en: 'AI Generate' },
  'ai.description': { zh: '用自然语言描述你的旅行计划，AI 会实时生成完整行程', en: 'Describe your trip in natural language — AI will generate a complete itinerary' },
  'ai.placeholder': { zh: '例如：我想五一去成都玩3天，预算3000以内，喜欢吃辣的，想去大熊猫基地、宽窄巷子、都江堰，住春熙路附近', en: 'e.g. I want a 3-day trip to Chengdu in May, budget under 3000, like spicy food, want to see Panda Base, Kuanzhai Alley, Dujiangyan, stay near Chunxi Road' },
  'ai.generate': { zh: '开始生成', en: 'Generate' },
  'ai.planning': { zh: 'AI 正在规划行程...', en: 'AI is planning your trip...' },
  'ai.waiting': { zh: '等待 AI 响应...', en: 'Waiting for AI response...' },
  'ai.generated': { zh: '行程已生成：', en: 'Generated: ' },
  'ai.confirm': { zh: '确认，查看行程', en: 'Confirm & view trip' },
  'ai.chatTitle': { zh: '和 AI 讨论修改', en: 'Chat with AI' },
  'ai.chatPlaceholder': { zh: '例如：把第二天酒店换成便宜点的、增加一个第三天去迪士尼...', en: 'e.g. Make the second day hotel cheaper, add Disney on day 3...' },
  'ai.thinking': { zh: 'AI 思考中...', en: 'AI thinking...' },
  'ai.applyChanges': { zh: '应用此修改', en: 'Apply changes' },
  'ai.applying': { zh: '应用中...', en: 'Applying...' },
  'ai.changesApplied': { zh: '已应用修改到行程！', en: 'Applied changes to trip.' },
  'ai.tripUpdated': { zh: '行程已更新。', en: 'Trip updated.' },

  // Import
  'import.title': { zh: '导入行程', en: 'Import trip' },
  'import.chooseMethod': { zh: '选择导入方式：', en: 'Choose import method:' },
  'import.newTrip': { zh: '+ 新建行程（由导入内容自动生成）', en: '+ New trip (auto-created from import)' },
  'import.orExisting': { zh: '或导入到已有行程：', en: 'or import into existing trip:' },
  'import.noTrips': { zh: '还没有行程', en: 'No trips yet' },
  'import.selectTrip': { zh: '选择行程...', en: 'Select trip...' },
  'import.importExisting': { zh: '导入到已有行程', en: 'Import into existing trip' },
  'import.newLabel': { zh: '新建', en: 'new' },
  'import.uploadFile': { zh: '上传文件', en: 'Upload file' },
  'import.pasteUrl': { zh: '粘贴链接', en: 'Paste URL' },
  'import.fileHint': { zh: '支持 Word (.docx)、Excel (.xlsx/.csv)、Markdown (.md) 文件', en: 'Supports Word (.docx), Excel (.xlsx/.csv), Markdown (.md) files' },
  'import.excelHint': { zh: 'Excel 列名支持: 天/Day/Label、类型/Type、标题/Title/名称、价格/Price/费用、备注/Note', en: 'Excel columns: Day/Label, Type, Title, Price, Note' },
  'import.urlHint': { zh: '粘贴携程、飞猪、马蜂窝等网站的跟团游/自由行链接，AI 自动解析为自由行行程', en: 'Paste a tour package URL from Ctrip, Fliggy, Mafengwo etc. — AI will parse it into a free-travel itinerary' },
  'import.importing': { zh: '导入中...', en: 'Importing...' },
  'import.import': { zh: '开始导入', en: 'Import' },
  'import.aiParse': { zh: 'AI 智能解析', en: 'AI Parse' },
  'import.aiParsing': { zh: 'AI 解析中...', en: 'AI parsing...' },
  'import.aiParseBtn': { zh: '使用 AI 智能解析', en: 'AI Parse' },
  'import.parsed': { zh: '成功解析', en: 'Parsed' },
  'import.parsedDays': { zh: '天', en: 'days' },
  'import.parsedItems': { zh: '个项目', en: 'items' },
  'import.tripLabel': { zh: '行程', en: 'Trip' },
  'import.destinationLabel': { zh: '目的地', en: 'Destination' },
  'import.rawTextNote': { zh: '未能结构化解析，已将原始文本保留', en: 'Could not fully structure, raw text preserved' },
  'import.structuredFailed': { zh: '未能自动结构化，可通过 AI 解析生成行程', en: 'Could not auto-structure. Use AI to parse into trip.' },
  'import.truncated': { zh: '... (内容已截断)', en: '... (truncated)' },
  'import.preview': { zh: '预览导入内容', en: 'Preview' },
  'import.importTo': { zh: '将导入至', en: 'Import to' },
  'import.reimport': { zh: '重新导入', en: 'Re-import' },
  'import.confirm': { zh: '确认导入到当前行程', en: 'Confirm import' },
  'import.createAndImport': { zh: '创建行程并导入', en: 'Create trip & import' },
  'import.day': { zh: '第', en: 'Day ' },
  'import.daySuffix': { zh: '天', en: '' },
};

interface LanguageContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'zh',
  setLang: () => {},
  t: (k: string) => k,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem('lang');
    return stored === 'en' ? 'en' : 'zh';
  });

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem('lang', l);
    setLangState(l);
  }, []);

  const t = useCallback(
    (key: string): string => {
      const entry = TRANSLATIONS[key];
      if (!entry) return key;
      return entry[lang] ?? key;
    },
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useT() {
  const ctx = useContext(LanguageContext);
  return { t: ctx.t, lang: ctx.lang, setLang: ctx.setLang };
}
