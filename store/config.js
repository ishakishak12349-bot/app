// إعدادات الموقع — هذا هو الملف الوحيد الذي تحتاج تعديله
window.ABDO_CONFIG = {
  // رابط سيرفر البوت (Render). المتجر يقرأ منه: API_URL + PRODUCTS_PATH
  API_URL: 'https://my-sit.onrender.com',
  PRODUCTS_PATH: '/api/products',

  // صفحة «عن المطور»
  ABOUT: {
    name: 'Abdo',
    bio: 'مطوّر برمجيات شغوف ببناء تطبيقات وأدوات مفيدة.\nتجد هنا كل ما أنشره عبر البوت، ويتحدّث الموقع تلقائياً عند إضافة أي تطبيق.',
    links: { 'تيليجرام': 'https://t.me/abdo_bot_dz' },
  },

  // أسماء التصنيفات القادمة من البوت (المفتاح = قيمة category في البيانات)
  CATEGORIES: {
    mobile: { ar: 'تطبيقات الهاتف', icon: '📱' },
    game: { ar: 'ألعاب', icon: '🎮' },
    pc: { ar: 'برامج الكمبيوتر', icon: '💻' },
    windows: { ar: 'برامج الكمبيوتر', icon: '💻' },
    tools: { ar: 'أدوات', icon: '🛠️' },
  },
};
