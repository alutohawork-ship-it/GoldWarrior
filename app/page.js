'use client';
import { useState, useEffect } from 'react';

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [pass, setPass] = useState('');
  const [view, setView] = useState('home');
  const [isAdmin, setIsAdmin] = useState(false);
  const [prices, setPrices] = useState([
    { sym: 'XAUUSD', price: 2345.50, change: -1.24 },
    { sym: 'BTCUSD', price: 67450.00, change: 2.14 },
    { sym: 'EURUSD', price: 1.0845, change: -0.32 },
  ]);

  // Simulasi Live Price
  useEffect(() => {
    if (!isLoggedIn) return;
    const interval = setInterval(() => {
      setPrices(prev => prev.map(p => ({
        ...p,
        price: p.price + (Math.random() - 0.5) * (p.sym === 'BTCUSD' ? 50 : 0.5),
        change: p.change + (Math.random() - 0.5) * 0.1
      })));
    }, 2000);
    return () => clearInterval(interval);
  }, [isLoggedIn]);

  const handleLogin = () => {
    if (pass === 'admin123') { setIsAdmin(true); setIsLoggedIn(true); }
    else if (pass === 'user123') { setIsAdmin(false); setIsLoggedIn(true); }
    else alert('Kode salah! Coba: admin123 atau user123');
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="bg-[#121212] p-6 rounded-2xl w-full max-w-sm border border-neutral-800">
          <h1 className="text-2xl font-bold text-white mb-1">Alu Signal Z <span className="text-blue-500">Pro</span></h1>
          <p className="text-neutral-500 text-sm mb-6">SMC x ICT x Alchemist</p>
          <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="Enter Access Code" className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-3 mb-4 text-white focus:outline-none focus:border-blue-500" />
          <button onClick={handleLogin} className="w-full bg-[#0066FF] text-white font-semibold py-3 rounded-xl">Login</button>
          <p className="text-xs text-neutral-600 mt-4 text-center">Hint: admin123 / user123</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col pb-20">
      {/* Header */}
      <header className="px-4 pt-4 pb-2 flex justify-between items-center bg-black sticky top-0 z-30">
        <div className="flex bg-neutral-900 rounded-full p-1">
          <button className="px-4 py-1 rounded-full bg-neutral-800 text-white text-sm font-semibold">Alu Signal</button>
          <button className="px-4 py-1 rounded-full text-neutral-500 text-sm font-semibold">Pro</button>
        </div>
        <div className="flex gap-4">
          <button className="relative text-white"><i className="fa-regular fa-bell text-xl"></i><span className="absolute -top-1 -right-1 bg-red-500 w-2 h-2 rounded-full"></span></button>
          <button onClick={() => setView('admin')} className="text-white"><i className="fa-regular fa-user text-xl"></i></button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto px-4 space-y-6">
        
        {view === 'home' && (
          <>
            {/* Quick Actions */}
            <div className="grid grid-cols-4 gap-4 py-2">
              {[
                { icon: 'fa-chart-line', color: 'text-blue-500', label: 'Manual', v: 'signal' },
                { icon: 'fa-eye', color: 'text-purple-500', label: 'Vision AI', v: 'vision' },
                { icon: 'fa-wallet', color: 'text-green-500', label: 'Rekap', v: 'recap' },
                { icon: 'fa-newspaper', color: 'text-orange-500', label: 'News', v: 'home' },
              ].map((item, i) => (
                <button key={i} onClick={() => setView(item.v)} className="flex flex-col items-center gap-1">
                  <div className={`w-12 h-12 rounded-full bg-neutral-900 flex items-center justify-center ${item.color}`}><i className={`fa-solid ${item.icon} text-xl`}></i></div>
                  <span className="text-xs text-neutral-400">{item.label}</span>
                </button>
              ))}
            </div>

            {/* Featured Signals */}
            <div className="grid grid-cols-2 gap-3 h-48">
              <div className="col-span-1 row-span-2 bg-[#121212] p-4 rounded-2xl border border-neutral-800 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1"><div className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-500 text-xs font-bold">Au</div><span className="font-semibold text-sm">XAUUSD</span></div>
                  <div className="text-2xl font-bold mb-1 text-red-500">SELL</div>
                  <div className="text-xs text-neutral-500">Entry: 2345.50</div>
                </div>
                <div className="text-green-500 text-sm font-semibold">-1.24%</div>
              </div>
              <div className="bg-[#121212] p-3 rounded-2xl border border-neutral-800">
                <div className="text-xs text-neutral-500">BTCUSD</div>
                <div className="text-lg font-bold">67,450</div>
                <div className="text-green-500 text-xs font-semibold">+2.14%</div>
              </div>
              <div className="bg-[#121212] p-3 rounded-2xl border border-neutral-800">
                <div className="text-xs text-neutral-500">EURUSD</div>
                <div className="text-lg font-bold">1.0845</div>
                <div className="text-red-500 text-xs font-semibold">-0.32%</div>
              </div>
            </div>

            {/* Market Stream */}
            <div>
              <h2 className="text-lg font-bold mb-3">Market Spotlight</h2>
              <div className="space-y-1">
                {prices.map((p, i) => (
                  <div key={i} className="flex items-center justify-between py-3 border-b border-neutral-900">
                    <div className="font-semibold text-sm">{p.sym}</div>
                    <div className="font-mono text-sm">{p.price.toFixed(p.sym.includes('USD') && p.sym !== 'BTCUSD' ? 4 : 2)}</div>
                    <div className={`text-xs font-medium ${p.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>{p.change >= 0 ? '▲' : '▼'} {Math.abs(p.change).toFixed(2)}%</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {view === 'signal' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">Manual Signal</h2>
            <div className="bg-[#121212] p-4 rounded-2xl border border-neutral-800">
              <div className="flex justify-center mb-4"><span className="bg-red-500 text-white font-bold px-6 py-2 rounded-full">SELL</span></div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-neutral-900 p-3 rounded-xl text-center"><div className="text-xs text-neutral-500">Entry</div><div className="font-bold">2345.50</div></div>
                <div className="bg-neutral-900 p-3 rounded-xl text-center"><div className="text-xs text-neutral-500">Stop Loss</div><div className="font-bold text-red-500">2350.00</div></div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-green-500/10 border border-green-500/30 p-2 rounded-xl text-center"><div className="text-xs text-green-500">TP1</div><div className="font-bold text-green-500 text-sm">2340</div></div>
                <div className="bg-green-500/10 border border-green-500/30 p-2 rounded-xl text-center"><div className="text-xs text-green-500">TP2</div><div className="font-bold text-green-500 text-sm">2335</div></div>
                <div className="bg-green-500/10 border border-green-500/30 p-2 rounded-xl text-center"><div className="text-xs text-green-500">TP3</div><div className="font-bold text-green-500 text-sm">2325</div></div>
              </div>
            </div>
            <div className="bg-[#121212] p-4 rounded-2xl border border-neutral-800 h-64 flex items-center justify-center text-neutral-600">
              [Live Chart Visual - SMC]
            </div>
          </div>
        )}

        {view === 'vision' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">Vision AI</h2>
            <div className="bg-[#121212] p-8 border-2 border-dashed border-neutral-800 text-center rounded-2xl">
              <i className="fa-solid fa-cloud-arrow-up text-3xl text-neutral-600 mb-2"></i>
              <p className="font-semibold text-sm">Upload Chart Image</p>
              <p className="text-xs text-neutral-500 mt-1">Max 3 images (JPG, PNG)</p>
            </div>
            <div className="bg-[#121212] p-4 rounded-2xl border border-neutral-800">
              <div className="flex justify-between items-center mb-4">
                <span className="bg-red-500 text-white font-bold px-4 py-1 rounded-full text-sm">SELL</span>
                <span className="text-yellow-500 text-xs">Confidence: Medium</span>
              </div>
              <div className="relative w-full h-48 bg-neutral-900 rounded-lg overflow-hidden mb-4 flex items-center justify-center text-neutral-600">
                [Chart Image + AI Lines]
              </div>
              <p className="text-xs text-neutral-400">AI Vision detected Bearish Engulfing at H4 Supply.</p>
            </div>
          </div>
        )}

        {view === 'admin' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-xl font-bold text-red-500">Admin Dashboard</h2>
              <button onClick={() => setView('home')} className="text-xs bg-neutral-800 px-3 py-1 rounded-lg">Exit</button>
            </div>
            <div className="bg-[#121212] p-4 rounded-2xl border border-neutral-800">
              <h3 className="font-semibold mb-2 text-sm">Announcements</h3>
              <textarea className="w-full bg-neutral-900 border border-neutral-800 rounded-lg p-2 text-sm h-20 mb-2 text-white" placeholder="Write info for users..."></textarea>
              <button className="w-full bg-[#0066FF] text-white py-2 rounded-lg text-sm font-semibold">Send Notification</button>
            </div>
            <div className="bg-[#121212] p-4 rounded-2xl border border-neutral-800">
              <h3 className="font-semibold mb-3 text-sm">User Management</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center bg-neutral-900 p-3 rounded-lg">
                  <div><div className="text-sm font-medium">user1@mail.com</div><div className="text-xs text-green-500">Lifetime</div></div>
                  <button className="text-red-500 text-xs">Ban</button>
                </div>
                <div className="flex justify-between items-center bg-neutral-900 p-3 rounded-lg">
                  <div><div className="text-sm font-medium">trial@mail.com</div><div className="text-xs text-yellow-500">Trial (2 left)</div></div>
                  <button className="text-blue-500 text-xs">Upgrade</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'recap' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">Rekap PNL</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#121212] p-4 rounded-2xl border border-neutral-800 text-center"><div className="text-xs text-neutral-500">Total PNL</div><div className="text-2xl font-bold text-green-500">+$1,240</div></div>
              <div className="bg-[#121212] p-4 rounded-2xl border border-neutral-800 text-center"><div className="text-xs text-neutral-500">Win Rate</div><div className="text-2xl font-bold text-yellow-500">68%</div></div>
            </div>
            <div className="bg-[#121212] p-4 rounded-2xl border border-neutral-800">
              <h3 className="font-semibold mb-3 text-sm">PNL Calendar</h3>
              <div className="grid grid-cols-7 gap-1 text-center text-xs text-neutral-600 mb-2"><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div><div>S</div></div>
              <div className="grid grid-cols-7 gap-1 text-center text-sm">
                <div className="p-2 bg-green-500/20 text-green-500 rounded">1</div><div className="p-2 bg-red-500/20 text-red-500 rounded">2</div><div className="p-2 bg-green-500/20 text-green-500 rounded">3</div><div className="p-2 text-neutral-700">4</div><div className="p-2 text-neutral-700">5</div><div className="p-2 bg-green-500/20 text-green-500 rounded">6</div><div className="p-2 bg-green-500/20 text-green-500 rounded">7</div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 w-full bg-black border-t border-neutral-900 flex justify-around py-2 pb-4 z-40">
        {[
          { id: 'home', icon: 'fa-house', label: 'Home' },
          { id: 'signal', icon: 'fa-chart-line', label: 'Signal' },
          { id: 'vision', icon: 'fa-eye', label: 'Vision' },
          { id: 'recap', icon: 'fa-wallet', label: 'Rekap' },
          { id: 'admin', icon: 'fa-shield-halved', label: 'Admin' },
        ].map(item => (
          <button key={item.id} onClick={() => setView(item.id)} className={`flex flex-col items-center gap-1 w-16 ${view === item.id ? 'text-white' : 'text-neutral-500'}`}>
            <i className={`fa-solid ${item.icon} text-xl`}></i>
            <span className="text-[10px]">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
