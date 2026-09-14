import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import axios from 'axios';
import { api } from '../../api/client';
import {
  AuthState,
  LoginCredentials,
  RegisterCredentials,
  AuthResponseData,
  ApiResponse,
} from './authTypes';

const initialState: AuthState = {
  user: null,
  accessToken: null,
  isAuthenticated: false,
  status: 'idle',
  error: null,
};

// Async Thunk: Register User
export const registerUser = createAsyncThunk<
  AuthResponseData,
  RegisterCredentials,
  { rejectValue: string }
>('auth/registerUser', async (credentials, { rejectWithValue }) => {
  try {
    const response = await api.post<ApiResponse<AuthResponseData>>('/auth/register', credentials);
    return response.data.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.data?.message) {
      return rejectWithValue(err.response.data.message as string);
    }
    return rejectWithValue('Registration failed');
  }
});

// Async Thunk: Login User
export const loginUser = createAsyncThunk<
  AuthResponseData,
  LoginCredentials,
  { rejectValue: string }
>('auth/loginUser', async (credentials, { rejectWithValue }) => {
  try {
    const response = await api.post<ApiResponse<AuthResponseData>>('/auth/login', credentials);
    return response.data.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.data?.message) {
      return rejectWithValue(err.response.data.message as string);
    }
    return rejectWithValue('Invalid email or password');
  }
});

// Async Thunk: Refresh / Check Existing Session on Page Refresh
export const checkAuth = createAsyncThunk<
  AuthResponseData,
  void,
  { rejectValue: string }
>('auth/checkAuth', async (_, { rejectWithValue }) => {
  try {
    const response = await axios.post<ApiResponse<AuthResponseData>>(
      '/api/v1/auth/refresh',
      {},
      { withCredentials: true }
    );
    return response.data.data;
  } catch {
    return rejectWithValue('No active session');
  }
});

// Async Thunk: Logout User
export const logoutUser = createAsyncThunk('auth/logoutUser', async () => {
  try {
    await api.post('/auth/logout');
  } catch {
    // Ignore network error on logout
  }
});

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (
      state,
      action: PayloadAction<{ user: AuthResponseData['user']; accessToken: string }>
    ) => {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.isAuthenticated = true;
      state.status = 'succeeded';
      state.error = null;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Register
      .addCase(registerUser.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(registerUser.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.isAuthenticated = true;
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.error = null;
      })
      .addCase(registerUser.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload || 'Registration failed';
      })

      // Login
      .addCase(loginUser.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.isAuthenticated = true;
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.error = null;
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload || 'Login failed';
      })

      // Check Auth (Session Restore)
      .addCase(checkAuth.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(checkAuth.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.isAuthenticated = true;
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.error = null;
      })
      .addCase(checkAuth.rejected, (state) => {
        state.status = 'idle';
        state.isAuthenticated = false;
        state.user = null;
        state.accessToken = null;
      })

      // Logout
      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null;
        state.accessToken = null;
        state.isAuthenticated = false;
        state.status = 'idle';
        state.error = null;
      });
  },
});

export const { setCredentials, clearError } = authSlice.actions;
export default authSlice.reducer;
