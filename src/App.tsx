import './App.css'
import ChessAnalysis from './components/ChessAnalysis'
import { useEffect } from 'react'

function App() {
  // Set dark mode by default
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 transition-colors duration-200">
      <header className="max-w-6xl mx-auto mb-4 md:mb-6 px-4 pt-4 md:pt-6">
        <div className="text-center md:text-left">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-100">Endgame</h1>
          <p className="text-sm md:text-base text-gray-400">Import and analyze chess games from PGN notation</p>
        </div>
      </header>
      
      <main className="px-2 md:px-4">
        <ChessAnalysis />
      </main>
      
      <footer className="max-w-6xl mx-auto mt-6 md:mt-8 pt-4 border-t border-gray-700 text-center text-gray-400 text-sm">
        <p>Made with ❤️ by MeBadDev.</p>
      </footer>
    </div>
  )
}

export default App
