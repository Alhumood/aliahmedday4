import { createContext, useContext, useEffect, useState } from 'react'

const translations = {
  en: {
    appName: 'Customer Hub',
    navDashboard: 'Dashboard',
    navCustomers: 'Customers',
    navKnowledge: 'Knowledge Bank',
    navChat: 'AI Assistant',
    apiConnected: 'API connected',
    apiUnreachable: 'API unreachable',
    apiChecking: 'Checking API…',
    aiKeyMissing: 'AI key not configured',
    openSwagger: 'Open Swagger docs ↗',
    language: 'العربية',

    customersTitle: 'Customers',
    customersSubtitle: 'Manage your customer records',
    addCustomer: '+ Add customer',
    chatWithAgent: '✨ Chat with agent',
    askAi: 'Ask AI',
    askAboutPrompt: (c) => `Tell me about customer #${c.customer_id} (${c.name})`,
    totalCustomers: 'Total customers',
    matchingCustomers: 'Matching customers',
    withEmail: 'With email',
    withPhone: 'With phone',
    searchPlaceholder: 'Search by name…',
    refresh: '↻ Refresh',
    colId: 'ID',
    colCustomer: 'Customer',
    colPhone: 'Phone',
    colCreated: 'Created',
    colActions: 'Actions',
    loading: 'Loading…',
    noCustomers: 'No customers found',
    noEmail: 'No email',
    edit: 'Edit',
    delete: 'Delete',
    cancel: 'Cancel',
    close: 'Close',
    editCustomer: 'Edit customer',
    deleteCustomer: 'Delete customer',
    deleteConfirm: (name) => (
      <>Delete <strong>{name}</strong>? This cannot be undone.</>
    ),
    customerCreated: 'Customer created',
    customerUpdated: 'Customer updated',
    customerDeleted: 'Customer deleted',

    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    nameRequired: 'Name is required',
    saving: 'Saving…',
    saveChanges: 'Save changes',
    createCustomer: 'Create customer',

    knowledgeTitle: 'Knowledge Bank',
    knowledgeSubtitle: 'Policies, procedures and answers the AI assistant can use',
    knowledgeSearch: 'Search articles…',
    knowledgeChatPrompt: 'What articles are in the knowledge bank?',
    addArticle: '+ Add article',
    editArticle: 'Edit article',
    deleteArticle: 'Delete article',
    allCategories: 'All',
    noArticles: 'No articles yet. Add your first one.',
    noArticlesMatch: 'No articles match your search',
    updatedOn: (date) => `Updated ${date}`,
    askAboutArticle: (a) => `Summarize the knowledge article "${a.title}"`,
    articleCreated: 'Article created',
    articleUpdated: 'Article updated',
    articleDeleted: 'Article deleted',
    articleTitle: 'Title',
    articleTitlePlaceholder: 'Refund policy',
    category: 'Category',
    categoryPlaceholder: 'Policies',
    content: 'Content',
    contentPlaceholder: 'Write the information the assistant should know…',
    titleRequired: 'Title is required',
    contentRequired: 'Content is required',
    createArticle: 'Create article',

    dashTitle: 'Dashboard',
    dashSubtitle: 'An overview of your customer base',
    dashThisMonth: 'New this month',
    dashLastMonth: (n) => `${n} last month`,
    dashComplete: 'Complete profiles',
    dashCompleteHint: 'Have both email and phone',
    dashMissing: 'Missing details',
    dashMissingHint: 'No email or no phone',
    dashGrowthTitle: 'New customers per month',
    dashGrowthSubtitle: 'Last 6 months',
    dashNewCustomers: 'new customers',
    dashContactTitle: 'Contact details',
    dashContactSubtitle: 'Share of customers with each detail',
    dashRecentTitle: 'Recently added',
    dashViewAll: 'View all →',

    chatTitle: 'AI Assistant',
    chatSubtitle: 'Ask questions about customers in plain language',
    newChat: 'New chat',
    chatWelcome: 'Hi! I can look up, add, and update customers, and answer questions from the knowledge bank.',
    chatPlaceholder: 'Ask about customers…',
    send: 'Send',
    you: 'You',
    ai: 'AI',
    suggestions: [
      'Get all customers',
      'Find customer named Kannan',
      'Add a customer named Sara Ali with email sara@example.com',
      'How many customers have a phone number?',
      'What is our refund policy?',
    ],
  },
  ar: {
    appName: 'مركز العملاء',
    navDashboard: 'لوحة المعلومات',
    navCustomers: 'العملاء',
    navKnowledge: 'بنك المعرفة',
    navChat: 'المساعد الذكي',
    apiConnected: 'الخادم متصل',
    apiUnreachable: 'تعذّر الاتصال بالخادم',
    apiChecking: 'جارٍ التحقق من الخادم…',
    aiKeyMissing: 'مفتاح الذكاء الاصطناعي غير مُعدّ',
    openSwagger: 'فتح توثيق Swagger ↗',
    language: 'English',

    customersTitle: 'العملاء',
    customersSubtitle: 'إدارة سجلات العملاء',
    addCustomer: '+ إضافة عميل',
    chatWithAgent: '✨ تحدث مع المساعد',
    askAi: 'اسأل الذكاء',
    askAboutPrompt: (c) => `أخبرني عن العميل رقم ${c.customer_id} (${c.name})`,
    totalCustomers: 'إجمالي العملاء',
    matchingCustomers: 'العملاء المطابقون',
    withEmail: 'لديهم بريد إلكتروني',
    withPhone: 'لديهم رقم هاتف',
    searchPlaceholder: 'ابحث بالاسم…',
    refresh: '↻ تحديث',
    colId: 'الرقم',
    colCustomer: 'العميل',
    colPhone: 'الهاتف',
    colCreated: 'تاريخ الإنشاء',
    colActions: 'الإجراءات',
    loading: 'جارٍ التحميل…',
    noCustomers: 'لا يوجد عملاء',
    noEmail: 'لا يوجد بريد إلكتروني',
    edit: 'تعديل',
    delete: 'حذف',
    cancel: 'إلغاء',
    close: 'إغلاق',
    editCustomer: 'تعديل العميل',
    deleteCustomer: 'حذف العميل',
    deleteConfirm: (name) => (
      <>هل تريد حذف <strong>{name}</strong>؟ لا يمكن التراجع عن هذا الإجراء.</>
    ),
    customerCreated: 'تمت إضافة العميل',
    customerUpdated: 'تم تحديث العميل',
    customerDeleted: 'تم حذف العميل',

    name: 'الاسم',
    email: 'البريد الإلكتروني',
    phone: 'الهاتف',
    nameRequired: 'الاسم مطلوب',
    saving: 'جارٍ الحفظ…',
    saveChanges: 'حفظ التغييرات',
    createCustomer: 'إضافة العميل',

    knowledgeTitle: 'بنك المعرفة',
    knowledgeSubtitle: 'سياسات وإجراءات وإجابات يستخدمها المساعد الذكي',
    knowledgeSearch: 'ابحث في المقالات…',
    knowledgeChatPrompt: 'ما المقالات الموجودة في بنك المعرفة؟',
    addArticle: '+ إضافة مقال',
    editArticle: 'تعديل المقال',
    deleteArticle: 'حذف المقال',
    allCategories: 'الكل',
    noArticles: 'لا توجد مقالات بعد. أضف أول مقال.',
    noArticlesMatch: 'لا توجد مقالات مطابقة للبحث',
    updatedOn: (date) => `آخر تحديث ${date}`,
    askAboutArticle: (a) => `لخّص مقال المعرفة "${a.title}"`,
    articleCreated: 'تمت إضافة المقال',
    articleUpdated: 'تم تحديث المقال',
    articleDeleted: 'تم حذف المقال',
    articleTitle: 'العنوان',
    articleTitlePlaceholder: 'سياسة الاسترجاع',
    category: 'التصنيف',
    categoryPlaceholder: 'السياسات',
    content: 'المحتوى',
    contentPlaceholder: 'اكتب المعلومات التي يجب أن يعرفها المساعد…',
    titleRequired: 'العنوان مطلوب',
    contentRequired: 'المحتوى مطلوب',
    createArticle: 'إضافة المقال',

    dashTitle: 'لوحة المعلومات',
    dashSubtitle: 'نظرة عامة على قاعدة العملاء',
    dashThisMonth: 'جدد هذا الشهر',
    dashLastMonth: (n) => `${n} في الشهر الماضي`,
    dashComplete: 'ملفات مكتملة',
    dashCompleteHint: 'لديهم بريد إلكتروني وهاتف',
    dashMissing: 'بيانات ناقصة',
    dashMissingHint: 'بدون بريد إلكتروني أو هاتف',
    dashGrowthTitle: 'العملاء الجدد شهرياً',
    dashGrowthSubtitle: 'آخر 6 أشهر',
    dashNewCustomers: 'عملاء جدد',
    dashContactTitle: 'بيانات التواصل',
    dashContactSubtitle: 'نسبة العملاء الذين لديهم كل معلومة',
    dashRecentTitle: 'أضيفوا مؤخراً',
    dashViewAll: 'عرض الكل ←',

    chatTitle: 'المساعد الذكي',
    chatSubtitle: 'اسأل عن العملاء بلغتك الطبيعية',
    newChat: 'محادثة جديدة',
    chatWelcome: 'مرحباً! يمكنني البحث عن العملاء وإضافتهم وتحديث بياناتهم، والإجابة من بنك المعرفة.',
    chatPlaceholder: 'اسأل عن العملاء…',
    send: 'إرسال',
    you: 'أنت',
    ai: 'ذكاء',
    suggestions: [
      'اعرض جميع العملاء',
      'ابحث عن العميل Kannan',
      'أضف عميلاً باسم سارة علي وبريده sara@example.com',
      'كم عدد العملاء الذين لديهم رقم هاتف؟',
      'ما هي سياسة الاسترجاع لدينا؟',
    ],
  },
}

const LanguageContext = createContext(null)

function initialLanguage() {
  try {
    const saved = localStorage.getItem('lang')
    if (saved in translations) return saved
  } catch {
    // storage unavailable; fall through to default
  }
  return 'en'
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(initialLanguage)

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    try {
      localStorage.setItem('lang', lang)
    } catch {
      // ignore
    }
  }, [lang])

  const value = {
    lang,
    t: translations[lang],
    locale: lang === 'ar' ? 'ar' : 'en',
    toggle: () => setLang((l) => (l === 'en' ? 'ar' : 'en')),
  }
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useI18n() {
  return useContext(LanguageContext)
}
