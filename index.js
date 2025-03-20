
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { saveUser, getUser, isUserRegistered } = require('./database');
const mongoose = require('mongoose');
const User = require('./database').User;

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const users = {}; // ذخیره وضعیت کاربران
const ADMIN_ID = process.env.ADMIN_ID; // شناسه مدیر (در .env تنظیم شود)
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    if (await isUserRegistered(chatId)) {
        const user = await getUser(chatId);
        return bot.sendMessage(chatId, `👋 خوش آمدید ${user.name}! لطفاً از دکمه‌های زیر استفاده کنید:`, {
            reply_markup: {
                keyboard: [
                    ["📋 مشاهده پروفایل", "📊 مشاهده پیشنهاد پرتفوی"],
                    ["✏️ ویرایش اطلاعات", "ℹ️ راهنما"]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        });
    }
    bot.sendMessage(chatId, "سلام! لطفاً نام خود را وارد کنید:");
    users[chatId] = { step: "waiting_for_name" };
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!users[chatId]) return;
    if (users[chatId].step === "waiting_for_name") {
        users[chatId].name = text;
        users[chatId].step = "waiting_for_phone";
        bot.sendMessage(chatId, "لطفاً شماره تلفن خود را به‌صورت دستی وارد کنید:");
    } else if (users[chatId].step === "waiting_for_phone") {
        if (/^\d{10,15}$/.test(text)) {
            users[chatId].phone = text;
            users[chatId].step = "waiting_for_investment";
            bot.sendMessage(chatId, "✅ ثبت‌نام انجام شد! حالا میزان سرمایه اولیه خود را (به تومان) وارد کنید:");
        } else {
            bot.sendMessage(chatId, "❌ شماره وارد شده معتبر نیست. لطفاً شماره تلفن خود را صحیح وارد کنید.");
        }
    } else if (users[chatId].step === "waiting_for_investment") {
        if (/^\d+$/.test(text)) {
            users[chatId].investment = parseInt(text);
            users[chatId].step = "waiting_for_risk";
            bot.sendMessage(chatId, "میزان ریسک‌پذیری خود را انتخاب کنید:", {
                reply_markup: {
                    keyboard: [["کم", "متوسط", "زیاد"]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            });
        } else {
            bot.sendMessage(chatId, "❌ لطفاً مقدار سرمایه را فقط به‌صورت عدد وارد کنید.");
        }
    } else if (users[chatId].step === "waiting_for_risk") {
        if (["کم", "متوسط", "زیاد"].includes(text)) {
            users[chatId].risk = text;
            users[chatId].step = "completed";
            
            const portfolio = generatePortfolio(users[chatId].investment, users[chatId].risk);
            
            await saveUser(chatId, users[chatId].name, users[chatId].phone, users[chatId].investment, users[chatId].risk);
            
            bot.sendMessage(chatId, `✅ اطلاعات شما ثبت شد!
👤 نام: ${users[chatId].name}
📞 شماره: ${users[chatId].phone}
💰 سرمایه: ${users[chatId].investment} تومان
⚖️ ریسک‌پذیری: ${users[chatId].risk}
\n📊 پیشنهاد پرتفوی:
${portfolio}`);
        } else {
            bot.sendMessage(chatId, "❌ لطفاً یکی از گزینه‌های پیشنهادی را انتخاب کنید.");
        }
    }
});
// افزایش تعداد تعاملات کاربر و محاسبه امتیاز جدید
async function updateUserScore(chatId) {
    const User = mongoose.model('User');
    const user = await User.findOne({ chatId });
    if (user) {
        user.interactions += 1;
        user.score = Math.round(user.investment / 1000000) + user.interactions; // فرمول امتیازدهی
        await user.save();
    }
}
// بروزرسانی امتیاز پس از هر تعامل
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    await updateUserScore(chatId);
});
// تابع پیشنهاد پرتفوی سرمایه‌گذاری بر اساس میزان ریسک و سرمایه
function generatePortfolio(investment, riskLevel) {
    let portfolio = "";
    let allocation = {};
    if (investment < 1000000) {
        return "❌ حداقل سرمایه لازم برای پیشنهاد پرتفوی ۱ میلیون تومان است.";
    }
    if (riskLevel === "کم") {
        allocation = {
            "اوراق قرضه": investment * 0.5,
            "سهام بنیادی": investment * 0.3,
            "طلا": investment * 0.2
        };
    } else if (riskLevel === "متوسط") {
        allocation = {
            "سهام بنیادی": investment * 0.4,
            "اوراق قرضه": investment * 0.2,
            "کریپتو": investment * 0.2,
            "طلا": investment * 0.1,
            "استارتاپ‌ها": investment * 0.1
        };
    } else {
        allocation = {
            "سهام رشد": investment * 0.5,
            "کریپتو": investment * 0.3,
            "استارتاپ‌ها": investment * 0.2
        };
    }
    portfolio = Object.entries(allocation)
        .map(([asset, amount]) => `📌 ${Math.round(amount).toLocaleString()} تومان - ${asset}`)
        .join("\n");
    return portfolio;
}


// دستور نمایش لیست کاربران
bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_ID) {
        return bot.sendMessage(chatId, "🚫 شما دسترسی به این بخش ندارید.");
    }
    
    const User = mongoose.model('User');
    const allUsers = await User.find({});
    if (allUsers.length === 0) {
        return bot.sendMessage(chatId, "⚠️ هیچ کاربری ثبت نشده است.");
    }
    
    let message = "📋 لیست کاربران ثبت‌شده:\n";
    allUsers.forEach((user, index) => {
        message += `👤 ${index + 1}. ${user.name} - ${user.phone} (ID: ${user.chatId})\n`;
    });
    
    bot.sendMessage(chatId, message);
});
// دستور ارسال پیام به کاربران
bot.onText(/\/send_message (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_ID) {
        return bot.sendMessage(chatId, "🚫 شما دسترسی به این بخش ندارید.");
    }
    
    const messageText = match[1];
    const User = mongoose.model('User');
    const allUsers = await User.find({}, 'chatId');
    
    if (allUsers.length === 0) {
        return bot.sendMessage(chatId, "⚠️ هیچ کاربری برای دریافت پیام وجود ندارد.");
    }
    
    let sentCount = 0;
    for (const user of allUsers) {
        try {
            await bot.sendMessage(user.chatId, `📢 پیام جدید:
${messageText}`);
            sentCount++;
        } catch (error) {
            console.error(`❌ خطا در ارسال پیام به ${user.chatId}:`, error);
        }
    }
    
    bot.sendMessage(chatId, `✅ پیام به ${sentCount} کاربر ارسال شد.`);
});
// دستور حذف کاربر بر اساس chat_id
bot.onText(/\/delete_user (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_ID) {
        return bot.sendMessage(chatId, "🚫 شما دسترسی به این بخش ندارید.");
    }
    const targetChatId = match[1];
    const User = mongoose.model('User');
    const deletedUser = await User.findOneAndDelete({ chatId: targetChatId });
    if (!deletedUser) {
        return bot.sendMessage(chatId, "❌ کاربر با این شناسه یافت نشد.");
    }
    bot.sendMessage(chatId, `✅ کاربر ${deletedUser.name} (ID: ${targetChatId}) با موفقیت حذف شد.`);
});
// دستور ویرایش نام
bot.onText(/\/edit_name (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const newName = match[1];
    const User = mongoose.model('User');
    await User.updateOne({ chatId }, { name: newName });
    bot.sendMessage(chatId, `✅ نام شما به "${newName}" تغییر یافت.`);
});
// دستور ویرایش شماره تلفن
bot.onText(/\/edit_phone (\d{10,15})/, async (msg, match) => {
    const chatId = msg.chat.id;
    const newPhone = match[1];
    const User = mongoose.model('User');
    await User.updateOne({ chatId }, { phone: newPhone });
    bot.sendMessage(chatId, `✅ شماره تلفن شما به "${newPhone}" تغییر یافت.`);
});
// دستور ویرایش میزان سرمایه
bot.onText(/\/edit_investment (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const newInvestment = parseInt(match[1]);
    const User = mongoose.model('User');
    await User.updateOne({ chatId }, { investment: newInvestment });
    bot.sendMessage(chatId, `✅ میزان سرمایه شما به "${newInvestment} تومان" تغییر یافت.`);
});
// دستور ویرایش سطح ریسک
bot.onText(/\/edit_risk (کم|متوسط|زیاد)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const newRisk = match[1];
    const User = mongoose.model('User');
    await User.updateOne({ chatId }, { risk: newRisk });
    bot.sendMessage(chatId, `✅ سطح ریسک شما به "${newRisk}" تغییر یافت.`);
});
// دستور ارسال پیام شخصی به یک کاربر خاص
bot.onText(/\/send_private (\d+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_ID) {
        return bot.sendMessage(chatId, "🚫 شما دسترسی به این بخش ندارید.");
    }
    const targetChatId = match[1]; // chat_id کاربر
    const messageText = match[2]; // متن پیام
    try {
        await bot.sendMessage(targetChatId, `📩 پیام جدید از مدیریت:\n\n${messageText}`);
        bot.sendMessage(chatId, `✅ پیام به کاربر ${targetChatId} ارسال شد.`);
    } catch (error) {
        console.error(`❌ خطا در ارسال پیام به ${targetChatId}:`, error);
        bot.sendMessage(chatId, "❌ خطایی رخ داد. لطفاً دوباره تلاش کنید.");
    }
});
// دستور مشاهده امتیاز کاربران
bot.onText(/\/scores/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_ID) {
        return bot.sendMessage(chatId, "🚫 شما دسترسی به این بخش ندارید.");
    }
    const User = mongoose.model('User');
    const allUsers = await User.find({}, 'name score interactions');
    if (allUsers.length === 0) {
        return bot.sendMessage(chatId, "⚠️ هیچ کاربری ثبت نشده است.");
    }
    let message = "📊 امتیاز کاربران:\n";
    allUsers.forEach((user, index) => {
        message += `👤 ${index + 1}. ${user.name} - امتیاز: ${user.score} (تعاملات: ${user.interactions})\n`;
    });
    bot.sendMessage(chatId, message);
});
// دستور مشاهده پروفایل کاربر
bot.onText(/\/profile/, async (msg) => {
    const chatId = msg.chat.id;
    const User = mongoose.model('User');
    const user = await User.findOne({ chatId });
    if (!user) {
        return bot.sendMessage(chatId, "❌ شما هنوز ثبت‌نام نکرده‌اید. لطفاً ابتدا دستور /start را بزنید.");
    }
    bot.sendMessage(chatId, `📋 **پروفایل شما:**\n\n👤 نام: ${user.name}\n📞 شماره: ${user.phone}\n💰 سرمایه: ${user.investment.toLocaleString()} تومان\n⚖️ ریسک‌پذیری: ${user.risk}\n⭐️ امتیاز: ${user.score}\n📊 تعاملات: ${user.interactions}`);
});
// دستور مشاهده مجدد پیشنهاد پرتفوی
bot.onText(/\/portfolio/, async (msg) => {
    const chatId = msg.chat.id;
    const User = mongoose.model('User');
    const user = await User.findOne({ chatId });
    if (!user) {
        return bot.sendMessage(chatId, "❌ شما هنوز ثبت‌نام نکرده‌اید. لطفاً ابتدا دستور /start را بزنید.");
    }
    const portfolio = generatePortfolio(user.investment, user.risk);
    bot.sendMessage(chatId, `📊 **پیشنهاد پرتفوی شما:**\n\n${portfolio}`);
});
// مدیریت دکمه‌های تعاملی
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const User = mongoose.model('User');
    const user = await User.findOne({ chatId });

    // نمایش پروفایل کاربر
    if (text === "📋 مشاهده پروفایل") {
        if (!user) {
            return bot.sendMessage(chatId, "❌ شما هنوز ثبت‌نام نکرده‌اید. لطفاً ابتدا دستور /start را بزنید.");
        }
        bot.sendMessage(chatId, `📋 **پروفایل شما:**\n\n👤 نام: ${user.name}\n📞 شماره: ${user.phone}\n💰 سرمایه: ${user.investment.toLocaleString()} تومان\n⚖️ ریسک‌پذیری: ${user.risk}\n⭐️ امتیاز: ${user.score}\n📊 تعاملات: ${user.interactions}`);
        return;
    }

    // نمایش پیشنهاد پرتفوی
    if (text === "📊 مشاهده پیشنهاد پرتفوی") {
        if (!user) {
            return bot.sendMessage(chatId, "❌ شما هنوز ثبت‌نام نکرده‌اید. لطفاً ابتدا دستور /start را بزنید.");
        }
        const portfolio = generatePortfolio(user.investment, user.risk);
        bot.sendMessage(chatId, `📊 **پیشنهاد پرتفوی شما:**\n\n${portfolio}`);
        return;
    }

    // نمایش منوی ویرایش اطلاعات
    if (text === "✏️ ویرایش اطلاعات") {
        bot.sendMessage(chatId, "🔧 لطفاً اطلاعاتی که می‌خواهید ویرایش کنید را انتخاب کنید:", {
            reply_markup: {
                keyboard: [
                    ["📝 ویرایش نام", "📞 ویرایش شماره"],
                    ["💰 ویرایش سرمایه", "⚖️ ویرایش ریسک"],
                    ["🔙 بازگشت"]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        });
        return;
    }

    // بازگشت به منوی اصلی
    if (text === "🔙 بازگشت") {
        delete users[chatId]; // حذف مرحله ویرایش
        bot.sendMessage(chatId, "🔙 به منوی اصلی بازگشتید.", {
            reply_markup: {
                keyboard: [
                    ["📋 مشاهده پروفایل", "📊 مشاهده پیشنهاد پرتفوی"],
                    ["✏️ ویرایش اطلاعات", "ℹ️ راهنما"]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        });
        return;
    }

    // نمایش راهنما
    if (text === "ℹ️ راهنما") {
        bot.sendMessage(chatId, "📌 **راهنمای استفاده از ربات:**\n\n🔹 برای مشاهده پروفایل خود، دکمه **📋 مشاهده پروفایل** را بزنید.\n🔹 برای دریافت مجدد پیشنهاد پرتفوی، دکمه **📊 مشاهده پیشنهاد پرتفوی** را بزنید.\n🔹 برای ویرایش اطلاعات، دکمه **✏️ ویرایش اطلاعات** را بزنید و گزینه موردنظر را انتخاب کنید.");
        return;
    }

    // تنظیم مرحله ویرایش برای کاربر
    if (text === "📝 ویرایش نام") {
        bot.sendMessage(chatId, "✏️ لطفاً نام جدید خود را وارد کنید:");
        users[chatId] = { step: "editing_name" };
        return;
    }

    if (text === "📞 ویرایش شماره") {
        bot.sendMessage(chatId, "📞 لطفاً شماره جدید خود را وارد کنید:");
        users[chatId] = { step: "editing_phone" };
        return;
    }

    if (text === "💰 ویرایش سرمایه") {
        bot.sendMessage(chatId, "💰 لطفاً میزان سرمایه جدید خود را به تومان وارد کنید:");
        users[chatId] = { step: "editing_investment" };
        return;
    }

    if (text === "⚖️ ویرایش ریسک") {
        bot.sendMessage(chatId, "⚖️ لطفاً سطح ریسک جدید خود را انتخاب کنید:", {
            reply_markup: {
                keyboard: [["کم", "متوسط", "زیاد"]],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        });
        users[chatId] = { step: "editing_risk" };
        return;
    }

    // اگر کاربر در مرحله ویرایش است، مقدار جدید را ذخیره کنیم
    if (!users[chatId]) return;

    if (users[chatId]?.step === "editing_name") {
        if (text !== "📝 ویرایش نام") {
            await User.updateOne({ chatId }, { name: text });
            bot.sendMessage(chatId, `✅ نام شما به "${text}" تغییر یافت.`);
            delete users[chatId];
        }
        return;
    }

    if (users[chatId]?.step === "editing_phone") {
        if (/^\d{10,15}$/.test(text)) {
            await User.updateOne({ chatId }, { phone: text });
            bot.sendMessage(chatId, `✅ شماره تلفن شما به "${text}" تغییر یافت.`);
            delete users[chatId];
        } else {
            bot.sendMessage(chatId, "❌ شماره وارد شده معتبر نیست. لطفاً شماره تلفن خود را صحیح وارد کنید.");
        }
        return;
    }

    if (users[chatId]?.step === "editing_investment") {
        if (/^\d+$/.test(text)) {
            await User.updateOne({ chatId }, { investment: parseInt(text) });
            bot.sendMessage(chatId, `✅ میزان سرمایه شما به "${parseInt(text).toLocaleString()} تومان" تغییر یافت.`);
            delete users[chatId];
        } else {
            bot.sendMessage(chatId, "❌ مقدار وارد شده معتبر نیست. لطفاً فقط عدد وارد کنید.");
        }
        return;
    }

    if (users[chatId]?.step === "editing_risk") {
        if (["کم", "متوسط", "زیاد"].includes(text)) {
            await User.updateOne({ chatId }, { risk: text });
            bot.sendMessage(chatId, `✅ سطح ریسک شما به "${text}" تغییر یافت.`, {
                reply_markup: {
                    keyboard: [
                        ["📋 مشاهده پروفایل", "📊 مشاهده پیشنهاد پرتفوی"],
                        ["✏️ ویرایش اطلاعات", "ℹ️ راهنما"]
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            });
            delete users[chatId];
        } else {
            bot.sendMessage(chatId, "❌ لطفاً یکی از گزینه‌های پیشنهادی (کم، متوسط، زیاد) را انتخاب کنید.");
        }
        return;
    }
});


console.log("ربات فعال شد!");
