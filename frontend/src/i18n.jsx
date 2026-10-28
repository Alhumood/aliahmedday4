import { createContext, useContext, useEffect, useState } from 'react'

const translations = {
  en: {
    appName: 'Customer Hub',
    navCustomers: 'Customers',
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

    chatTitle: 'AI Assistant',
    chatSubtitle: 'Ask questions about customers in plain language',
    newChat: 'New chat',
    chatWelcome: 'Hi! I can look up, add, and update customers. Ask me anything about your customer data.',
    chatPlaceholder: 'Ask about customers…',
    send: 'Send',
    you: 'You',
    ai: 'AI',
    suggestions: [
      'Get all customers',
      'Find customer named Kannan',
      'Add a customer named Sara Ali with email sara@example.com',
      'How many customers have a phone number?',
    ],
  },
  ar: {
    appName: 'مركز العملاء',
    navCustomers: 'العملاء',
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

    chatTitle: 'المساعد الذكي',
    chatSubtitle: 'اسأل عن العملاء بلغتك الطبيعية',
    newChat: 'محادثة جديدة',
    chatWelcome: 'مرحباً! يمكنني البحث عن العملاء وإضافتهم وتحديث بياناتهم. اسألني أي شيء عن بيانات العملاء.',
    chatPlaceholder: 'اسأل عن العملاء…',
    send: 'إرسال',
    you: 'أنت',
    ai: 'ذكاء',
    suggestions: [
      'اعرض جميع العملاء',
      'ابحث عن العميل Kannan',
      'أضف عميلاً باسم سارة علي وبريده sara@example.com',
      'كم عدد العملاء الذين لديهم رقم هاتف؟',
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
