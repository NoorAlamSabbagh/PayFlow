import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { store } from '../store';
import { setCredentials, logoutUser } from '../features/auth/authSlice';
import { ApiResponse, AuthResponseData } from '../features/auth/authTypes';

// Extended request config for retry flag
interface CustomRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true, // Always send HttpOnly cookies for refresh token
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: Attach in-memory Access Token
api.interceptors.request.use(
  (config) => {
    const token = store.getState().auth.accessToken;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Seamless 401 Refresh Queue
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: AxiosError | null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve();
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as CustomRequestConfig;

    // If error is not 401 or request is already retried or it's the refresh/login endpoint itself
    if (
      !error.response ||
      error.response.status !== 401 ||
      originalRequest._retry ||
      originalRequest.url?.includes('/auth/refresh') ||
      originalRequest.url?.includes('/auth/login')
    ) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      // Queue incoming requests while the refresh is ongoing
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then(() => api(originalRequest))
        .catch((err) => Promise.reject(err));
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      // Call refresh endpoint - the browser automatically supplies the HttpOnly refreshToken cookie
      const refreshResponse = await axios.post<ApiResponse<AuthResponseData>>(
        '/api/v1/auth/refresh',
        {},
        { withCredentials: true }
      );

      const { user, accessToken } = refreshResponse.data.data;

      // Update Redux state with new access token
      store.dispatch(setCredentials({ user, accessToken }));

      processQueue(null);

      // Retry the original request with the new access token
      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      }

      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError as AxiosError);
      store.dispatch(logoutUser());
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);
