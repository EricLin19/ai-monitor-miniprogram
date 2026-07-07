# AI Monitor 手动更新模板

把你看到的市场数据、研报摘录、新闻截图或判断按下面格式发给 Codex。能填多少填多少，不需要完整。

## 单个指标更新

```text
指标：
新数值：
单位：
变化说明：
来源：
来源链接：
日期：
备注：
```

示例：

```text
指标：GPU 租赁价格
新数值：H100 $2.10/hr
单位：H100
变化说明：较上周下降
来源：Lambda GPU Cloud
来源链接：https://lambdalabs.com/service/gpu-cloud
日期：2026-07-07
备注：先作为 H100 spot/公开报价代理
```

## ARR / 事件更新

```text
公司：
指标：ARR / run-rate / 用户数 / 融资 / 估值
新数值：
来源：
日期：
可信度：高 / 中 / 低
备注：
```

## 文章归档

```text
文章主题：
核心观点：
新增指标：
已有指标需要调整：
它讲的故事：
我自己的判断：
```

## 当前手动维护指标

| 指标 ID | 显示名称 | 你可以发什么 |
| --- | --- | --- |
| `gpu_rental_price` | GPU 租赁价格 | H100 / B200 / GB200 小时价格 |
| `api_price_index` | 主流模型 API 价格指数 | OpenAI / Claude / Gemini / DeepSeek 输入输出价格 |
| `agent_token_share` | Agent Token 占比 | OpenRouter / Fireworks / 平台披露的 Agent 占比 |
| `revenue_per_gpu` | 单位 GPU 每日收入 | 云平台收入、GPU 数量、租赁价格估算 |
| `anthropic_arr` | Anthropic ARR / run-rate | 媒体、融资、采访披露 |
| `openai_arr` | OpenAI ARR / run-rate | 媒体、融资、采访披露 |

