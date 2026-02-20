import { getDashboardData } from '@/actions';
import { MonitoringTable } from '@/components/ui/MonitoringTable';
import { Activity } from 'lucide-react';
import AdminButton from '@/components/ui/AdminButton';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let targets: Awaited<ReturnType<typeof getDashboardData>> = [];
  let errorMsg = null;

  try {
    targets = await getDashboardData();
  } catch (e: any) {
    console.error("Dashboard Error:", e);
    errorMsg = e.message || "Unknown error occurred";
    if (JSON.stringify(e).includes("binding")) {
      errorMsg += " (Potential DB Binding Issue)";
    }
  }

  return (
    <main className="min-h-screen bg-[#0F172A] text-slate-200 selection:bg-[#39FF14] selection:text-[#0F172A] flex flex-col">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 bg-[#0F172A]/90 backdrop-blur-md border-b border-white/5">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-br from-[#39FF14] to-emerald-600 flex items-center justify-center shadow-[0_0_10px_rgba(57,255,20,0.3)]">
              <Activity className="w-4 h-4 text-[#0F172A]" />
            </div>
            <h1 className="font-bold text-lg tracking-tight text-white">
              경기도교육청 <span className="text-[#39FF14]">EduMonitor</span>
            </h1>
          </div>

          <AdminButton />
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 pt-20 pb-10 flex-grow">
        {errorMsg ? (
          <div className="p-4 bg-red-900/50 border border-red-500 rounded text-red-200">
            <h2 className="font-bold text-lg mb-2">System Error (Debug Mode)</h2>
            <p className="font-mono text-sm">{errorMsg}</p>
            <p className="mt-4 text-xs text-slate-400">
              If this says "Database binding not found", please check Cloudflare Pages Settings - Bindings.
            </p>
          </div>
        ) : (
          <MonitoringTable targets={targets} />
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 py-6 bg-[#0B1120]">
        <div className="container mx-auto px-4 text-center">
          {/* Logo Placeholder - If you have the image, place it in public/logo.png and uncomment below */}
          {/* <img src="/logo.png" alt="PYHGOSHIFT" className="h-8 mx-auto mb-3 opacity-80" /> */}
          <h3 className="text-[#39FF14] font-black tracking-widest text-lg mb-2">PYHGOSHIFT</h3>

          <div className="text-slate-600 text-[10px] space-y-1">
            <p>경기도교육청 EduMonitor System &copy; 2026</p>
            <p>Developed by <span className="text-slate-400 font-bold">PYHGOSHIFT</span></p>
            <p>Contact: <a href="mailto:pyhgoshfit@gmail.com" className="hover:text-white transition-colors">pyhgoshfit@gmail.com</a></p>
          </div>
        </div>
      </footer>
    </main>
  );
}
