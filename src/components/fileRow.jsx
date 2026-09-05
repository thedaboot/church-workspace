import React from 'react';
import { FileText, File, FileSpreadsheet, Presentation } from 'lucide-react';

// ============================================================================
// 파일 한 줄의 생김새 — 업무 첨부(modals/attachments.jsx)와 주보 송폼
// (components/worshipDetail.jsx)이 **같은 한 벌**을 쓴다.
// ----------------------------------------------------------------------------
// 0047에서 송폼을 붙이면서 갈라졌던 자리다. 크기 표기와 종류 칩을 화면마다 따로 두면
// 같은 PDF가 업무에서는 빨간 칩, 주보에서는 회색 칩으로 서게 된다 — 첨부 업로드가
// 두 벌이었을 때 겪은 것과 같은 종류의 어긋남이다(§6-29 머리말).
//
// 순수하다 — 스토어도 통신도 물지 않는다. 그래서 어느 화면에서 들여도 딸려 오는 것이
// 없다(attachments.jsx를 그대로 import하면 워크스페이스 스토어가 예배 화면까지 따라온다).
// ============================================================================

export const formatBytes = (b) => {
  if (b === null || b === undefined) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

export const fileKind = (name = '', mime = '') => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const has = (m) => (mime || '').includes(m);
  if (ext === 'pdf' || has('pdf')) return { chip: 'bg-tag-red text-tag-red-fg', icon: <FileText size={16} strokeWidth={1.75} /> };
  if (['doc', 'docx'].includes(ext) || has('word')) return { chip: 'bg-tag-blue text-tag-blue-fg', icon: <FileText size={16} strokeWidth={1.75} /> };
  if (['ppt', 'pptx'].includes(ext) || has('presentation')) return { chip: 'bg-tag-orange text-tag-orange-fg', icon: <Presentation size={16} strokeWidth={1.75} /> };
  if (['xls', 'xlsx', 'csv'].includes(ext) || has('sheet') || has('excel') || has('csv')) return { chip: 'bg-tag-green text-tag-green-fg', icon: <FileSpreadsheet size={16} strokeWidth={1.75} /> };
  return { chip: 'bg-tag-gray text-tag-gray-fg', icon: <File size={16} strokeWidth={1.75} /> };
};
