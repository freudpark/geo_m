import GoogleSheetSync from '@/components/admin/GoogleSheetSync';
import ExcelUploader from '@/components/admin/ExcelUploader';
import DeleteAllButton from '@/components/admin/DeleteAllButton';
import { getAllTargets } from '@/actions';
import { Activity, ExternalLink } from 'lucide-react';

export const runtime = 'edge'; // Enabled for Cloudflare Pages

export default async function AdminPage() {
    const targets = await getAllTargets();

    return (
        <div className="min-h-screen flex flex-col pt-16 bg-[#0F172A] text-slate-200">
            {/* Header */}
            <header className="fixed top-0 w-full z-50 bg-[#0F172A]/80 backdrop-blur-md border-b border-white/5">
                <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-gradient-to-br from-[#39FF14] to-emerald-600 flex items-center justify-center shadow-[0_0_15px_rgba(57,255,20,0.3)]">
                            <Activity className="w-5 h-5 text-[#0F172A]" />
                        </div>
                        <h1 className="font-bold text-xl tracking-tight text-white hidden md:block">
                            EduMonitor <span className="text-[#39FF14]">Admin</span>
                        </h1>
                        <h1 className="font-bold text-xl tracking-tight text-white md:hidden">
                            Admin
                        </h1>
                    </div>
                    <a href="/" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">
                        Go to Dashboard
                    </a>
                </div>
            </header>

            <main className="flex-1 p-4 md:p-8 max-w-5xl mx-auto w-full space-y-8">

                {/* 1. Google Sheets Sync */}
                <section className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden p-6 shadow-xl">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <span className="w-1 h-6 bg-[#39FF14] rounded-full"></span>
                            데이터 동기화 (구글 시트)
                        </h2>
                    </div>
                    <GoogleSheetSync />
                </section>

                {/* 2. Target List */}
                <section className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                    <div className="p-6 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                                등록 사이트 목록
                            </h2>
                            <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full text-xs font-mono">
                                {targets.length}
                            </span>
                        </div>
                        <DeleteAllButton />
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-slate-400">
                            <thead className="bg-slate-950/50 text-slate-500 font-medium border-b border-slate-800 uppercase text-xs">
                                <tr>
                                    <th className="p-4 w-32 whitespace-nowrap">구분</th>
                                    <th className="p-4 whitespace-nowrap">홈페이지명</th>
                                    <th className="p-4">URL</th>
                                    <th className="p-4 w-24 text-center whitespace-nowrap">상태</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {targets.map((target) => (
                                    <tr key={target.id} className="hover:bg-slate-800/30 transition-colors">
                                        <td className="p-4 whitespace-nowrap">
                                            <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium border ${target.category === '본청/직속기관'
                                                ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                                                : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                                }`}>
                                                {target.category || '지역교육청'}
                                            </span>
                                        </td>
                                        <td className="p-4 font-bold text-slate-200 whitespace-nowrap">
                                            {target.name}
                                        </td>
                                        <td className="p-4">
                                            <a
                                                href={target.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="flex items-center gap-1.5 text-slate-500 hover:text-[#39FF14] transition-colors max-w-[200px] md:max-w-xs truncate group"
                                            >
                                                <span className="truncate">{target.url}</span>
                                                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </a>
                                        </td>
                                        <td className="p-4 text-center whitespace-nowrap">
                                            <span className={`inline-flex w-2 h-2 rounded-full ${target.is_active ? 'bg-[#39FF14] shadow-[0_0_8px_#39FF14]' : 'bg-slate-600'}`}></span>
                                        </td>
                                    </tr>
                                ))}
                                {targets.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="p-12 text-center text-slate-600">
                                            데이터가 없습니다. 위에서 동기화를 진행하거나 엑셀을 업로드하세요.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* 3. Excel Upload (Bottom) */}
                <section className="opacity-60 hover:opacity-100 transition-opacity">
                    <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-6">
                        <h2 className="text-lg font-semibold mb-4 text-slate-400 flex items-center gap-2">
                            <span className="w-1 h-5 bg-slate-600 rounded-full"></span>
                            수동 업로드 (엑셀)
                        </h2>
                        <ExcelUploader />
                    </div>
                </section>

                <footer className="text-center text-slate-600 text-xs py-8">
                    Use Google Sheets Sync for best experience.
                </footer>
            </main>
        </div>
    );
}
