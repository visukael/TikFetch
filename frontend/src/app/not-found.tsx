import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#fafafa] text-[#09090b] p-4 font-sans">
      <div className="max-w-md w-full bg-white border border-[#e4e4e7] rounded-[28px] p-8 text-center shadow-sm animate-fade-in">
        <div className="w-14 h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-5 border border-red-100">
          <AlertCircle className="w-7 h-7" />
        </div>
        
        <span className="inline-block px-3 py-1 bg-zinc-100 border border-zinc-200 text-zinc-600 text-xs font-mono font-medium rounded-full mb-3">
          404 - NOT_FOUND
        </span>
        
        <h1 className="text-2xl font-bold tracking-tight text-[#09090b] mb-2">
          Halaman Tidak Ditemukan
        </h1>
        
        <p className="text-sm text-zinc-500 leading-relaxed mb-6">
          Halaman atau resource yang Anda cari tidak tersedia, telah dipindahkan, atau terjadi kesalahan URL.
        </p>

        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 w-full py-3.5 px-5 bg-[#09090b] hover:bg-zinc-800 text-white rounded-[18px] font-medium text-sm transition-all duration-200 shadow-sm hover:shadow active:scale-[0.98]"
        >
          <ArrowLeft className="w-4 h-4" />
          Kembali ke Beranda
        </Link>
      </div>
    </div>
  );
}
