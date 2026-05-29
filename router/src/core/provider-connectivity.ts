export interface ProviderConnectivityResult {
  statusCode: number;
  body: string;
}

export interface IProviderConnectivityChecker {
  fetchModels(
    baseUrl: string,
    apiKey: string,
    modelsEndpoint: string,
    apiType: string,
  ): Promise<ProviderConnectivityResult>;
}
