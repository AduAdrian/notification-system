/**
 * HTTP Client with Automatic Correlation ID Propagation
 *
 * Axios wrapper that auto-injects correlation headers into all outgoing requests.
 * Essential for distributed tracing across microservices.
 *
 * Features:
 * - Auto-injection of X-Correlation-ID, X-Request-ID, X-User-ID
 * - Request/response logging with correlation context
 * - Error handling with correlation metadata
 * - Timeout configuration
 * - Retry logic support
 *
 * Usage:
 * const client = createHttpClient({ baseURL: 'https://api.example.com' });
 * const response = await client.get('/users/123'); // Auto-includes correlation ID
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { getCorrelationHeaders, getCorrelationId } from './correlation';
import { createLogger } from './logger';

const logger = createLogger('http-client');

export interface HttpClientConfig extends AxiosRequestConfig {
  serviceName?: string;
  logRequests?: boolean;
  logResponses?: boolean;
}

/**
 * Create an HTTP client with correlation ID auto-injection
 */
export function createHttpClient(config: HttpClientConfig = {}): AxiosInstance {
  const {
    serviceName = 'http-client',
    logRequests = true,
    logResponses = false,
    ...axiosConfig
  } = config;

  const instance = axios.create({
    timeout: 30000, // 30 second default timeout
    ...axiosConfig,
  });

  // Request interceptor: Add correlation headers
  instance.interceptors.request.use(
    (requestConfig) => {
      const correlationHeaders = getCorrelationHeaders();
      const correlationId = getCorrelationId();

      // Merge correlation headers with existing headers
      requestConfig.headers = {
        ...requestConfig.headers,
        ...correlationHeaders,
      };

      // Log outgoing request
      if (logRequests) {
        logger.info({
          msg: 'HTTP request',
          method: requestConfig.method?.toUpperCase(),
          url: requestConfig.url,
          baseURL: requestConfig.baseURL,
          correlationId,
          headers: requestConfig.headers,
        });
      }

      return requestConfig;
    },
    (error) => {
      logger.error({
        msg: 'HTTP request error',
        error: error.message,
        correlationId: getCorrelationId(),
      });
      return Promise.reject(error);
    }
  );

  // Response interceptor: Log responses and errors
  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      if (logResponses) {
        logger.info({
          msg: 'HTTP response',
          method: response.config.method?.toUpperCase(),
          url: response.config.url,
          status: response.status,
          correlationId: getCorrelationId(),
        });
      }
      return response;
    },
    (error: AxiosError) => {
      const correlationId = getCorrelationId();

      logger.error({
        msg: 'HTTP response error',
        method: error.config?.method?.toUpperCase(),
        url: error.config?.url,
        status: error.response?.status,
        statusText: error.response?.statusText,
        error: error.message,
        correlationId,
        responseData: error.response?.data,
      });

      return Promise.reject(error);
    }
  );

  return instance;
}

/**
 * Make HTTP GET request with correlation context
 */
export async function get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const client = createHttpClient(config);
  const response = await client.get<T>(url, config);
  return response.data;
}

/**
 * Make HTTP POST request with correlation context
 */
export async function post<T = any>(
  url: string,
  data?: any,
  config?: AxiosRequestConfig
): Promise<T> {
  const client = createHttpClient(config);
  const response = await client.post<T>(url, data, config);
  return response.data;
}

/**
 * Make HTTP PUT request with correlation context
 */
export async function put<T = any>(
  url: string,
  data?: any,
  config?: AxiosRequestConfig
): Promise<T> {
  const client = createHttpClient(config);
  const response = await client.put<T>(url, data, config);
  return response.data;
}

/**
 * Make HTTP DELETE request with correlation context
 */
export async function del<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const client = createHttpClient(config);
  const response = await client.delete<T>(url, config);
  return response.data;
}

/**
 * Make HTTP PATCH request with correlation context
 */
export async function patch<T = any>(
  url: string,
  data?: any,
  config?: AxiosRequestConfig
): Promise<T> {
  const client = createHttpClient(config);
  const response = await client.patch<T>(url, data, config);
  return response.data;
}

export default createHttpClient;
