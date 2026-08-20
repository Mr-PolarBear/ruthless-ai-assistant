// localStorage 空间检测工具

/**
 * 检测 localStorage 剩余可用空间（字节）
 * @returns {number} 剩余字节数
 */
export function getLocalStorageRemainingSpace() {
    // 采用二分法快速检测最大可用空间
    let min = 0;
    let max = 1024 * 1024 * 20; // 20MB 上限，通常浏览器限制在5MB左右
    let testKey = '__ls_space_test__';
    let lastSuccess = 0;
    try {
        while (min <= max) {
            let mid = ((min + max) / 2) | 0;
            try {
                localStorage.setItem(testKey, '0'.repeat(mid));
                lastSuccess = mid;
                min = mid + 1;
            } catch (e) {
                max = mid - 1;
            }
        }
    } finally {
        localStorage.removeItem(testKey);
    }
    return lastSuccess;
}
