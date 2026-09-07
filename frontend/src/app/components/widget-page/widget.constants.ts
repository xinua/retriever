export const WIDGET_CODE = (url: string, id: number) => `
  type: iframe
  url: ${url}/widget/${id}
  aspect_ratio: 50%
`;

export const HA_AUTOMATION_CODE = (webhookId: string, watcherId: number) => `
  alias: Retriever
  description: 'Notify when a new video is available'
  mode: single
  conditions: []
  triggers:
    - trigger: webhook
      allowed_methods:
        - POST
        - PUT
      local_only: true
      webhook_id: ${webhookId}
  actions:
    - if:
        - condition: template
          value_template: '{{ trigger.json.watcherId == ${watcherId} }}'
      then:
        - action: notify.mobile_app_<device_name>
          metadata: {}
          data:
            title: '{{ trigger.json.channel }}, new video'
            message: '{{ trigger.json.title }}'
          enabled: true
          continue_on_error: true
`;
