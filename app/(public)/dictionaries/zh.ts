import type { Dict } from "../dictionaries.ts";

// The public site's Simplified Chinese copy. `Partial<Dict>`, so a key left
// out — or left empty — renders the English string instead of a blank or a
// key (`dictionary()` in ../dictionaries.ts). tests/dictionary.test.ts prints
// whatever is still untranslated.
//
// Drafted in the public-site-chinese change and awaiting a native read
// (proposal L5). The consent line is the one string a reviewer may not
// paraphrase freely: it is a permission, and it must keep naming email and
// WhatsApp and the same use as the English.
export const zh: Partial<Dict> = {
  "chrome.schedule": "课程时间表",
  "chrome.enquiry": "联系我们",
  "chrome.language": "切换语言",

  "schedule.title": "课程时间表 — LEAD",
  "schedule.description":
    "LEAD 近期课程：日期、授课语言、地点、价格，以及是否可申请 HRDC 津贴。",
  "schedule.heading": "课程时间表",
  "schedule.standfirst": "近期公开课程。日期与时间均为马来西亚时间。",
  "schedule.lastUpdated": "课程时间表最后更新于 {when}。",
  "schedule.empty.heading": "目前没有安排公开课程",
  "schedule.empty.cta": "告诉我们您想上什么课",
  "schedule.error.heading": "课程时间表暂时无法加载",
  "schedule.error.body": "请稍后再试。",
  "schedule.error.retry": "重试",

  "filter.language": "授课语言",
  "filter.track": "课程类别",
  "filter.city": "城市",
  "filter.noMatch": "没有课程符合这些筛选条件。",
  "filter.clear": "清除筛选",

  "language.en": "英文",
  "language.zh": "中文",

  "card.dates": "日期",
  "card.where": "地点",
  "card.price": "价格",
  "card.online": "线上",
  "card.hrdc": "可申请 HRDC 津贴",
  "card.seats.available": "尚有名额",
  "card.seats.few_seats": "名额不多",
  "card.seats.full": "已满",
  "card.enquire": "咨询",
  "card.register": "报名",
  "card.register.full": "此课程名额已满",
  "card.register.notOpen": "此课程尚未开放报名",

  "track.certification": "认证课程",
  "track.mastery": "进阶课程",
  "track.masterclass": "大师班",
  "track.workshop": "工作坊",
  "track.conference": "大会",
  "track.corporate": "企业内训",

  "enquiry.title": "咨询 — LEAD",
  "enquiry.description": "告诉我们您想了解什么，我们会就 LEAD 的课程与您联系。",
  "enquiry.heading": "联系我们",
  "enquiry.heading.class": "咨询 {course}",
  "enquiry.standfirst":
    "告诉我们您想了解什么，我们会就日期、价格与 HRDC 申请与您联系。",
  "enquiry.class.meta": "{code} · {date} 开课。",
  "enquiry.class.metaCity": "{code} · {date} 开课 · {city}。",
  "enquiry.class.invite": "告诉我们您想了解什么，我们会尽快回复您。",

  "form.required": "（必填）",
  "form.fullName": "姓名",
  "form.email": "电子邮箱",
  "form.email.hint": "留下电子邮箱或电话号码，其中一项即可。",
  "form.phone": "电话号码",
  "form.phone.hint": "马来西亚手机号码，例如 +60 12-345 6789 或 012-345 6789。",
  "form.company": "公司",
  "form.jobTitle": "职位",
  "form.preferredLanguage": "希望我们使用的语言",
  "form.message": "您想了解什么？",
  "form.hrdc": "我想以 HRDC 津贴支付这门课程。",
  // §10.3的句子，不多不少（spec v1.24）。"优惠" extends the consent and the
  // unsubscribe promise is not one v1 keeps, so both are gone here as well
  // as in English.
  "form.consent": "我愿意通过电子邮件和 WhatsApp 接收 LEAD 课程的最新消息。",
  "form.submit": "发送咨询",
  "form.submitting": "发送中…",
  "form.privacy": "我们如何使用您的资料",
  "form.honeypot": "公司网站",
  "form.contactRequired": "请填写电子邮箱或电话号码",
  "form.thankYou.heading": "已经收到，谢谢您。",
  "form.thankYou.body":
    "我们的同事会在一个工作日内，通过您留下的电子邮箱或电话号码与您联系。",

  "error.captcha_failed": "我们无法确认您是真人，请再试一次。",
  "error.rate_limited": "短时间内提交了多次咨询，请一分钟后再试。",
  "error.payload_too_large": "内容太长，请缩短后再提交。",
  "error.validation_failed": "请检查标示出来的栏位。",
  "error.not_configured":
    "我们暂时无法接收咨询，请发电子邮件给我们，我们会跟进。",
  "error.server_error": "我们这边出了问题，请再试一次。",

  "field.fullName": "请填写您的姓名。",
  "field.email": "请填写有效的电子邮箱，或留空并改填电话号码。",
  "field.phone": "请填写可以联系到您的电话号码，不超过 40 个字符。",
  "field.tooLong": "内容太长，请缩短。",
  "field.default": "请检查这个栏位。",

  "error.class_unavailable":
    "这个班次已经不开放报名。请另选日期，或告诉我们您想上哪一班。",
  "error.no_seats":
    "您填写的时候，最后一个座位刚好被订走了。请另选日期，或问我们下一班。",
  "error.already_enrolled":
    "您已经报名这个班次。详情在我们发给您的邮件里；如果没有收到，请告诉我们。",

  "register.title": "报名 — LEAD",
  "register.description":
    "报名 LEAD 即将开课的班次。可以用银行卡付款，也可以告诉我们您要用 HRDC 申请。",
  "register.heading": "报名 {course}",
  "register.standfirst": "继续下一步后，座位为您保留 24 小时。",
  "register.summary.dates": "日期",
  "register.summary.time": "时间",
  "register.summary.where": "地点",
  "register.summary.price": "费用",
  "register.summary.seats": "座位",
  "register.submit": "继续付款",
  "register.submitting": "正在前往付款页…",
  "register.hrdcNote":
    "要用 HRDC 申请？勾选下面的选项，我们会向您的公司开发票，不收银行卡付款。",
  "register.hrdc.heading": "关于 HRDC 申请，我们会联系您。",
  "register.hrdc.body":
    "HRDC 的座位以发票结算，不用银行卡付款。我们的同事会联系您办理申请并确认座位。",
  "register.unavailable.heading": "这个班次不开放报名",
  "register.unavailable.body":
    "它可能已经开课、满座，或者已经从课表撤下。最新的日期都在课表页上。",
  "register.full.heading": "这个班次已满座",
  "register.full.body": "问我们下一个日期，一开放我们就通知您。",
  "register.closed.heading": "报名尚未开放",
  "register.closed.body":
    "这个班次暂时无法用银行卡付款。告诉我们您有兴趣，我们会回复您。",
  "register.toSchedule": "查看课表",
  "register.toEnquiry": "咨询这个班次",

  "thankYou.title": "谢谢 — LEAD",
  "thankYou.description": "报名已经完成，以下是接下来的安排。",
  "thankYou.heading": "谢谢您，付款已经完成。",
  "thankYou.body":
    "我们会用电子邮件和 WhatsApp 发给您上课资料，包括地点、开始时间和需要准备的东西。",
  "thankYou.noSession.heading": "目前还没有确认的报名",
  "thankYou.noSession.body":
    "这个页面上找不到对应的付款记录。如果您中途离开了，请从课表重新开始，或者告诉我们，我们帮您查。",
};
