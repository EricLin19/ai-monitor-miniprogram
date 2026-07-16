Page({
  data: {
    sections: [
      {
        title: "OpenRouter 看什么",
        body: "OpenRouter 更像模型 API 聚合器和路由层。开发者用一个统一接口调用 OpenAI、Anthropic、Google、DeepSeek、Qwen、Kimi、xAI 等模型。它反映的是开发者、Agent、脚本和应用层的推理流量。"
      },
      {
        title: "Ramp 看什么",
        body: "Ramp AI Index 来自企业支出样本，更接近美国企业是否真的把 AI 工具放进预算、公司卡、采购和报销流程。它反映的是企业付费采用，而不是单纯 token 数量。"
      },
      {
        title: "为什么两者不矛盾",
        body: "OpenRouter 上便宜模型、免费模型、中国模型靠前，说明成本敏感型开发者流量很活跃；Ramp 里 OpenAI 和 Anthropic 占比较高，说明美国企业正式采购仍集中在头部闭源模型。一个偏领先流量，一个偏付费确认。"
      }
    ],
    contrasts: [
      { left: "OpenRouter", right: "开发者 API 调用、低成本模型测试、Coding Agent、自动化脚本" },
      { left: "Ramp", right: "企业采购、订阅支出、公司卡付款、预算化采用" },
      { left: "OpenRouter 强", right: "说明模型拿到了推理流量，但不一定拿到企业预算" },
      { left: "Ramp 强", right: "说明模型进入企业采购链条，商业质量更高" }
    ],
    playbook: [
      "OpenRouter Token Share：看推理流量往哪里走，尤其低成本模型和中国模型是否拿量。",
      "Ramp Model Adoption：看企业预算往哪里走，谁真正进入企业采购。",
      "两者背离时重点观察：OpenRouter 先涨、Ramp 后涨，通常意味着从开发者扩散到企业预算。",
      "如果 OpenRouter 很强但 Ramp 很弱，说明还停留在试用、开发者或价格敏感场景。",
      "如果 Ramp 里 DeepSeek、Qwen、Kimi 等开始上升，那才是企业采购迁移的更强信号。"
    ]
  }
});
