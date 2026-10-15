export interface AppConfiguration {
  environment: 'demo';
  features: string[];
}

export const configuration: AppConfiguration = {
  environment: 'demo',
  features: ['catalog', 'cart', 'checkout'],
};

export function startApp(config: AppConfiguration): string[] {
  return config.features.map((feature) => `forgeshop:${feature}`);
}
