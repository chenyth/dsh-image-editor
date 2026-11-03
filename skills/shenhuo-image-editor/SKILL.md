---
name: shenhuo-image-editor
description: 将用户图片分离成可编辑图层，在默认浏览器打开原文档，按需导出并下载 PSD。通过个人账号 OAuth 和神火 MCP，分离前明确确认积分。
---

# 神火图层编辑器

用户说“拆分这张图的文字和背景”“把海报变成可编辑图层”“导出 PSD”或调用本 Skill 时使用。所有业务工具以 `shenhuo_editor_` 开头；字段以 `shenhuo_editor_status` 返回的实时工具目录为准。使用线上现有编辑器，不在 DSH 右侧创建编辑器或注入网页脚本。

## 连接与输入

1. 先调用 `shenhuo_editor_status`。已授权时核对实际账号和图层工具，不重复登录。需要授权时用 `shenhuo_editor_connect`，展示其真实授权链接，待用户完成后再检查 status。无账号可到 https://www.shenhuoai.com/register 注册。不得索要 API Key、密码、Cookie 或 Token。
2. 安装了提供共享接口的神火设计师时复用原连接；首次单独使用本插件才创建自己的连接。遇到 `SHENHUO_CONNECTION_UPGRADE_REQUIRED`，引导升级原设计师插件，不读取其凭证或偷偷另建连接。403 insufficient_scope 由原连接刷新一次；刷新失败恢复原连接，不换账号、重建任务或复制凭证。
3. 要求用户提供图片或明确选择其工作区内的图片。用 `shenhuo_editor_upload_file` 传原始字节，取得 `receipt.asset_id`；不得把文件路径、Base64、作品 ID 当 asset_id。无本地工作区时请用户选择工作区或直接在网页操作，不虚报上传。工作区外图片须由用户或宿主文件能力复制进工作区。
   上传/下载回执的 `expires_at` 是临时传输票据有效期，不是图片素材、文档或作品的保留期限。完成上传后的 asset_id 可以继续用于后续报价；不得从票据到期时间推断素材已失效，也不得编造保留期限。
4. 用户选择神火生成图时，先确认作品可用并同意分层，再用原神火设计师的交付工具下载已结算原图，上传得到新 asset_id。不要自动串联生图与付费分层；输入仅为上传图片，新分层项目与生成源项目可能不同。无需匹配设计师或创建提案。

## 分离与网页交付

1. 默认 `delivery_target=document`。只有用户直接要 PSD 时选择 `psd`。调用 `shenhuo_editor_quote_layer_separation`，保存 quote_id、document_id、document_revision、delivery_target、expires_at。
2. 按回执展示预计消耗、所需预占、可用积分、缺口、有效期和交付方式；没有的费用字段不猜。明确问用户是否同意当前报价。只有用户明确同意后才调用 `shenhuo_editor_separate_layers` 并传 `user_confirmed=true`；安装/授权插件、此前生图确认、只问价格都不是本次付费确认。拒绝就停在报价，不启动分离。报价过期或文档/交付方式变化须重报价并重新确认。积分不足暂停原任务，可使用同账号官网核验余额，恢复后重新报价确认。
3. 为每次写操作生成一个稳定 ASCII 幂等键。保存返回的 `separation.id`；用 `shenhuo_editor_wait_for_result(kind=separation,task_id=原ID)` 实际持续轮询，`done=false` 就继续等待查询，直到成功/失败/取消。服务端 poll_after_ms 更长时必须遵守；不要查几次就结束，不承诺对话结束后自动通知。
4. `document` 成功且 export_id=null 是正常完成。用实际返回的 editor_url 展示“打开图层编辑器”链接，用户点击后在系统默认浏览器编辑。缺链接时调用 `shenhuo_editor_get_layer_editor`；不要拼 URL 或用固定编辑器首页代替任务结果。网页登录与 OAuth 独立，必要时说明同账号登录，登录后返回原链接。
5. 只引用对应 separation 回执中的 consumed_credits 和结算状态。不从余额差或预估推算扣费，不承诺所有文字/效果完全可编辑。不自动创建第二个付费任务或重试分离。

## PSD 交付

- `psd` 一步模式成功后，从 `separation.export_id` 取得导出 ID；用 `shenhuo_editor_download_psd` 保存文件，不要额外启动导出。
- `document` 模式下用户后来要 PSD（含网页编辑后），先提醒保存网页修改，再调用 `shenhuo_editor_get_layer_editor` 读取当前 document_revision，使用原 separation_id 调 `shenhuo_editor_export_layer_psd`。保存返回的 job.id，以 `wait_for_result(kind=export,task_id=job.id)` 轮询至终态，然后用 `job.export.id` 下载。
- REVISION_CONFLICT 时重新读取版本并让用户明确选定导出版本，不能静默导出新版。导出固定的是提交时文档版本，不自动同步后续网页修改。
- 下载成功必须以工具返回的 `downloaded=true`、真实绝对路径、字节数及 SHA-256 为准，给用户可打开的本地文件链接。文件名冲突会自动加序号保留原文件。
- 下载链接仅十分钟有效；过期只用新的领取键再下载。导出失败保留原分离文档，用户要求后重新导出，不重做 AI 分离、不重复扣分离费用。不能用 transfer 的 pending 状态覆盖成功的分离状态。
- 没有本地文件能力时可以调用 get_layer_result 提供真实短期下载链接，并明确“尚未保存到本地”；不把票据写入文档或日志，不声称已经下载。

## 中断、失败与取消

`shenhuo_editor_resume` 只返回当前账号的本地恢复记录，不是实时状态。按类型使用原 ID 查询：分离用 separation.id，导出用 job.id，下载用 export_id。超时未知写操作只允许重放原参数和原幂等键；不得换键猜测重试。服务报错、授权恢复、会话恢复都不丢弃原任务。取消仅在用户明确要求时调用 cancel_layer_separation，随后继续查询结算终态，不保证未扣积分。用户停止等待不等于取消服务器任务。

## 示例

- “把工作区 poster.png 的文字和背景分开，我想在网页里改字。” → 上传、document 报价、等待明确确认、分离轮询、真实文档链接。
- “我已在网页保存修改，下载当前 PSD。” → 读取原任务当前文档版本、独立导出、轮询、校验并保存文件。
- “Turn this poster into editable layers and deliver a PSD.” → Confirm the current credit quote, separate with psd delivery, poll the original separation, download and verify the PSD. Keep responses in the user's language.
