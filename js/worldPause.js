// 普通生存的阅读暂停谓词：纯状态依赖，UI与物理公开tick共用，避免拉入渲染初始化环。
import { isCreative, state } from './state.js';
export function isWorldPausedAt(uiState=state.uiState||'playing') {
    if(isCreative()||state.levelRun||state.levelEdit)return false;
    const el=typeof document==='undefined'?null:document.activeElement;
    const typing=el&&(/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)||el.isContentEditable===true);
    return uiState!=='playing'||!!state.windowUnfocused||!!globalThis.document?.hidden||!!typing||
        !!state.helpDocOpen||!!state.questionBankOpen||!!state.authorPanelOpen||
        !!state.prefabPickerOpen||!!state.levelExportOpen||!!state.recordingControlsOpen||
        Object.values(state.readingPanels||{}).some(Boolean);
}
