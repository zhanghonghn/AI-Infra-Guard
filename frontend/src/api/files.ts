import axios from 'axios';
import type { ApiResponse } from '@/types/api';
import type { UploadResult } from '@/types/task';
import { getAuthToken, getCurrentUsername } from '@/utils/auth';

/**
 * Upload a single file via POST /api/v1/app/tasks/uploadFile (multipart).
 *
 * The shared axios instance forces `application/json`, so we use a
 * one-off axios call here to let the browser set the multipart boundary.
 */
export async function uploadTaskFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);

  const username = getCurrentUsername() || 'public_user';
  const token = getAuthToken();

  const resp = await axios.post<ApiResponse<UploadResult>>(
    '/api/v1/app/tasks/uploadFile',
    form,
    {
      headers: {
        username,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      onUploadProgress: (e) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    },
  );
  const body = resp.data;
  if (body && body.status === 0) {
    return body.data;
  }
  throw new Error(body?.message || '文件上传失败');
}
