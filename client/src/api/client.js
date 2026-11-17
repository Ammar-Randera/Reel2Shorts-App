const API_BASE = '/api';

/**
 * Custom request wrapper around fetch with auth handling
 */
async function request(endpoint, options = {}) {
  const token = localStorage.getItem('reel2shorts_token');
  const headers = {
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorMsg = data && data.error ? data.error : `Request failed with status ${response.status}`;
    const err = new Error(errorMsg);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

export const api = {
  get: (endpoint) => request(endpoint, { method: 'GET' }),
  post: (endpoint, body) => request(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: (endpoint, body) => request(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (endpoint) => request(endpoint, { method: 'DELETE' }),
};

/**
 * Upload single or multiple video files using FormData with upload progress support
 */
export function uploadFiles(files, isMultiple = false, onProgress = null) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    if (isMultiple) {
      for (const file of files) {
        formData.append('videos', file);
      }
    } else {
      formData.append('video', files[0]);
    }

    const xhr = new XMLHttpRequest();
    const endpoint = isMultiple ? '/api/videos/upload-multiple' : '/api/videos/upload';

    xhr.open('POST', endpoint);

    const token = localStorage.getItem('reel2shorts_token');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      try {
        const response = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(response);
        } else {
          reject(new Error(response.error || `Upload failed with status ${xhr.status}`));
        }
      } catch (e) {
        reject(new Error(`Server error: ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error occurred during upload.'));
    };

    xhr.send(formData);
  });
}

export default api;
