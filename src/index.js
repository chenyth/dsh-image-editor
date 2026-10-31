import manifest from '../package.json' with { type: 'json' };

export const name = 'dsh-image-editor';
export const inject = ['tools'];

export function apply(ctx) {
  ctx.tools.register({
    name: 'shenhuo_image_editor_info',
    description: '查看神火图层编辑插件的当前开发状态。只读，不打开图片、不连接账号、不执行图层分离或编辑，也不消费积分。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          stage: { type: 'string' },
          editor_available: { type: 'boolean' },
          cloud_connected: { type: 'boolean' },
          message: { type: 'string' }
        },
        required: ['name', 'version', 'stage', 'editor_available', 'cloud_connected', 'message'],
        additionalProperties: false
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    execute: async () => ({
      name: manifest.name,
      version: manifest.version,
      stage: 'initialization',
      editor_available: false,
      cloud_connected: false,
      message: '项目已初始化；画布、图层编辑、AI 分离、云端授权与导出尚未接入。'
    })
  });
}
