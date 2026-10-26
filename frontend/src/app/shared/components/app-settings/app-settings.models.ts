export interface CodeExample {
  value: string;
  name: string;
  code: string;
}

export interface CodeExamples {
  webhooks: CodeExample[];
  automations: CodeExample[];
  widget: CodeExample;
}

export enum Browser {
  Firefox = 'Firefox',
  Chrome = 'Chrome',
  Other = 'Other',
}
