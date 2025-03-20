const mongoose = require('mongoose');
require('dotenv').config();

// اصلاح شده: اتصال به دیتابیس بدون گزینه‌های قدیمی
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ اتصال به MongoDB برقرار شد!"))
    .catch(err => console.log("❌ خطا در اتصال به دیتابیس:", err));


// تعریف مدل کاربر
const userSchema = new mongoose.Schema({
    chatId: { type: Number, required: true, unique: true },
    score: { type: Number, default: 0 },  // امتیاز کاربر
    interactions: { type: Number, default: 0 }, // تعداد تعاملات
    name: String,
    phone: String,
    investment: Number,
    risk: String
    
});

const User = mongoose.model('User', userSchema);

// تابع ذخیره‌سازی کاربر
async function saveUser(chatId, name, phone, investment, risk) {
    try {
        const user = new User({ chatId, name, phone, investment, risk });
        await user.save();
        console.log("✅ کاربر ذخیره شد:", user);
    } catch (error) {
        console.log("❌ خطا در ذخیره کاربر:", error);
    }
}

// تابع دریافت اطلاعات کاربر بر اساس chatId
async function getUser(chatId) {
    return await User.findOne({ chatId });
}

// تابع بررسی ثبت‌نام کاربر
async function isUserRegistered(chatId) {
    const user = await User.findOne({ chatId });
    return !!user;
}

module.exports = {
    saveUser,
    getUser,
    isUserRegistered
};
