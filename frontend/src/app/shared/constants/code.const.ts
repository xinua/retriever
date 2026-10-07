export const notifyWebhook = {
  watcherId: 1,
  channel: 'Channel Name',
  videoId: '4f35jL3Wd',
  title: 'Video Title',
  type: 'video',
  date: '2026-01-01T00:00:00.000Z',
  path: 'Channel Name/Video Title.mp4',
  fileUrl: '/api/downloads/1/file?inline=1',
};

export const playWebhook = {
  id: 1,
  title: 'Download name',
  filePath: 'music/test.mp3',
  fileUrl: '/api/downloads/1/file?inline=1',
  type: 'audio',
  format: 'mp3',
};

export const notifyWebhookExample = JSON.stringify(notifyWebhook, null, 2);
export const playWebhookExample = JSON.stringify(playWebhook, null, 2);

export const notifyAutomationExample = `alias: Retriever
description: 'Notify when a new video is available'
mode: single
conditions: []
triggers:
  - trigger: webhook
    allowed_methods:
      - POST
      - PUT
    local_only: true
    webhook_id: <webhook_id>
actions:
  - if:
      - condition: template
        value_template: '{{ trigger.json.watcherId == <watcher_id> }}'
    then:
      - action: notify.mobile_app_<device_name>
        metadata: {}
        data:
          title: '{{ trigger.json.channel }}, new video'
          message: '{{ trigger.json.title }}'
        enabled: true
        continue_on_error: true
`;

export const playDownloadAutomationExample = `alias: Retriever - Play media
description: ''
triggers:
  - trigger: webhook
    allowed_methods:
      - POST
      - PUT
    local_only: true
    webhook_id: <webhook_id>
conditions: []
actions:
  - action: media_player.play_media
    target:
      entity_id: media_player.home_assistant_voice_09c1e1_media_player
    data:
      media:
        media_content_id: <retriever_url>{{ trigger.json.fileUrl }}
        media_content_type: music
        metadata: {}
    enabled: true
    alias: Play from URL
  - action: media_player.play_media
    target:
      entity_id: media_player.home_assistant_voice_09c1e1_media_player
    data:
      media:
        media_content_id: >-
          media-source://media_source/local/<nas_media>/<:downloads>/{{trigger.json.filePath }}
        media_content_type: audio/mpeg
        metadata: {}
    alias: Play from path
mode: single

`;

export const WIDGET_CODE = (url: string, id: number) => `type: iframe
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
