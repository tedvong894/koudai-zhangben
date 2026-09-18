// 默认种子数据：账本 + 分类（模仿有鱼记账，含大小类）
// 分类用 pk（自身键）与 parentKey（父大类键）描述层级，播种时解析为真实 id。
window.SEED = {
  ledgers: [
    { name: "默认账本", icon: "📒", color: "#4C8DFF" }
  ],
  categories: [
    // ===== 支出 =====
    // 大类
    { pk: "food",    name: "餐饮", type: "expense", icon: "🍜", color: "#FF6B5E", builtin: true },
    { pk: "transit", name: "交通", type: "expense", icon: "🚌", color: "#4C8DFF", builtin: true },
    { pk: "shop",    name: "购物", type: "expense", icon: "🛍️", color: "#FF8A5B", builtin: true },
    { pk: "home",    name: "居家", type: "expense", icon: "🏠", color: "#9B6BFF", builtin: true },
    { pk: "fun",     name: "娱乐", type: "expense", icon: "🎮", color: "#36C5C5", builtin: true },
    { pk: "medical", name: "医疗", type: "expense", icon: "💊", color: "#FF5E9A", builtin: true },
    { pk: "edu",     name: "教育", type: "expense", icon: "📚", color: "#5B8DEF", builtin: true },
    { pk: "comm",    name: "通讯", type: "expense", icon: "📱", color: "#7C6BFF", builtin: true },
    { pk: "gift",    name: "人情", type: "expense", icon: "🎁", color: "#FF9F43", builtin: true },
    { pk: "travel",  name: "旅行", type: "expense", icon: "✈️", color: "#26C6DA", builtin: true },
    { pk: "oexp",    name: "其他", type: "expense", icon: "📦", color: "#9AA0B5", builtin: true },
    // 小类
    { pk: "food_b",  parentKey: "food",    name: "早餐", type: "expense", icon: "🍳", color: "#FF9F43", builtin: true },
    { pk: "food_l",  parentKey: "food",    name: "午餐", type: "expense", icon: "🍚", color: "#FFB74D", builtin: true },
    { pk: "food_d",  parentKey: "food",    name: "晚餐", type: "expense", icon: "🍲", color: "#FF8A65", builtin: true },
    { pk: "food_p",  parentKey: "food",    name: "聚餐", type: "expense", icon: "🍻", color: "#FF7043", builtin: true },
    { pk: "food_c",  parentKey: "food",    name: "咖啡", type: "expense", icon: "☕", color: "#8D6E63", builtin: true },
    { pk: "tr_sub",  parentKey: "transit", name: "公交地铁", type: "expense", icon: "🚇", color: "#5B8DEF", builtin: true },
    { pk: "tr_tax",  parentKey: "transit", name: "打车", type: "expense", icon: "🚕", color: "#42A5F5", builtin: true },
    { pk: "tr_gas",  parentKey: "transit", name: "加油", type: "expense", icon: "⛽", color: "#1E88E5", builtin: true },
    { pk: "tr_park", parentKey: "transit", name: "停车", type: "expense", icon: "🅿️", color: "#2196F3", builtin: true },
    { pk: "sh_cloth",parentKey: "shop",    name: "服饰", type: "expense", icon: "👕", color: "#FF7043", builtin: true },
    { pk: "sh_digi", parentKey: "shop",    name: "数码", type: "expense", icon: "📱", color: "#FF5722", builtin: true },
    { pk: "sh_daily",parentKey: "shop",    name: "日用", type: "expense", icon: "🧴", color: "#FF8A65", builtin: true },
    { pk: "sh_beau", parentKey: "shop",    name: "美妆", type: "expense", icon: "💄", color: "#FF4081", builtin: true },
    { pk: "hm_rent", parentKey: "home",    name: "房租", type: "expense", icon: "🔑", color: "#7C6BFF", builtin: true },
    { pk: "hm_util", parentKey: "home",    name: "水电", type: "expense", icon: "💡", color: "#9575CD", builtin: true },
    { pk: "hm_prop", parentKey: "home",    name: "物业", type: "expense", icon: "🏢", color: "#B39DDB", builtin: true },
    { pk: "fn_mov",  parentKey: "fun",     name: "电影", type: "expense", icon: "🎬", color: "#26C6DA", builtin: true },
    { pk: "fn_game", parentKey: "fun",     name: "游戏", type: "expense", icon: "🕹️", color: "#00BCD4", builtin: true },
    { pk: "fn_fit",  parentKey: "fun",     name: "健身", type: "expense", icon: "🏋️", color: "#4DD0E1", builtin: true },
    { pk: "md_clin", parentKey: "medical", name: "门诊", type: "expense", icon: "🏥", color: "#F06292", builtin: true },
    { pk: "md_drug", parentKey: "medical", name: "药品", type: "expense", icon: "💉", color: "#EC407A", builtin: true },
    { pk: "ed_book", parentKey: "edu",     name: "书籍", type: "expense", icon: "📖", color: "#64B5F6", builtin: true },
    { pk: "ed_cour", parentKey: "edu",     name: "课程", type: "expense", icon: "🎓", color: "#42A5F5", builtin: true },
    { pk: "co_fee",  parentKey: "comm",    name: "话费", type: "expense", icon: "📞", color: "#9575CD", builtin: true },
    { pk: "co_net",  parentKey: "comm",    name: "宽带", type: "expense", icon: "🌐", color: "#7E57C2", builtin: true },
    { pk: "gf_gift", parentKey: "gift",    name: "礼金", type: "expense", icon: "🧧", color: "#FF7043", builtin: true },
    { pk: "gf_treat",parentKey: "gift",    name: "请客", type: "expense", icon: "🍽️", color: "#FF8A65", builtin: true },
    { pk: "tv_air",  parentKey: "travel",  name: "机票", type: "expense", icon: "✈️", color: "#4DD0E1", builtin: true },
    { pk: "tv_hotel",parentKey: "travel",  name: "酒店", type: "expense", icon: "🏨", color: "#00BCD4", builtin: true },
    { pk: "oe_oth",  parentKey: "oexp",    name: "其他", type: "expense", icon: "📦", color: "#9AA0B5", builtin: true },

    // ===== 收入 =====
    { pk: "work",  name: "工作",   type: "income", icon: "💼", color: "#2BBF7A", builtin: true },
    { pk: "invest",name: "投资",   type: "income", icon: "📈", color: "#4C8DFF", builtin: true },
    { pk: "oinc",  name: "其他收入", type: "income", icon: "💵", color: "#9AA0B5", builtin: true },
    { pk: "wk_sal", parentKey: "work",   name: "工资", type: "income", icon: "💰", color: "#2BBF7A", builtin: true },
    { pk: "wk_bon", parentKey: "work",   name: "奖金", type: "income", icon: "🏆", color: "#36C5C5", builtin: true },
    { pk: "iv_fin", parentKey: "invest", name: "理财", type: "income", icon: "📊", color: "#4C8DFF", builtin: true },
    { pk: "iv_div", parentKey: "invest", name: "股息", type: "income", icon: "💹", color: "#1E88E5", builtin: true },
    { pk: "oi_part",parentKey: "oinc",   name: "兼职", type: "income", icon: "💼", color: "#9AA0B5", builtin: true },
    { pk: "oi_red", parentKey: "oinc",   name: "红包", type: "income", icon: "🧧", color: "#FF5E9A", builtin: true },
    { pk: "oi_oth", parentKey: "oinc",   name: "其他", type: "income", icon: "💵", color: "#9AA0B5", builtin: true }
  ],
  assets: [
    { akey: "bank",   name: "银行存款", icon: "🏦", color: "#4C8DFF", kind: "asset",  balance: 0 },
    { akey: "cash",   name: "现金",     icon: "💵", color: "#2BBF7A", kind: "asset",  balance: 0 },
    { akey: "alipay", name: "支付宝",   icon: "🔰", color: "#1677FF", kind: "asset",  balance: 0 },
    { akey: "wechat", name: "微信",     icon: "💬", color: "#07C160", kind: "asset",  balance: 0 },
    { akey: "credit", name: "信用卡",   icon: "💳", color: "#FF6B5E", kind: "credit", balance: 0 }
  ]
};
