import { useState, useRef, useEffect } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';

interface ChessAnalysisProps {}

interface ChessMove {
  from: string;
  to: string;
  san: string;
  fen: string;
}

export default function ChessAnalysis({}: ChessAnalysisProps) {
  const [game, setGame] = useState(new Chess());
  const [fen, setFen] = useState(game.fen());
  const [history, setHistory] = useState<string[]>([]);
  const [moveHistory, setMoveHistory] = useState<ChessMove[]>([]);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [pgn, setPgn] = useState('');
  const [gameImported, setGameImported] = useState(false);
  const [boardWidth, setBoardWidth] = useState(400);
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const chessboardRef = useRef(null);
  
  // Refs for scrolling to the current move
  const moveHistoryContainerRef = useRef<HTMLDivElement>(null);
  const currentMoveRef = useRef<HTMLTableRowElement>(null);

  // Resize the chess board when the container size changes
  useEffect(() => {
    function updateBoardSize() {
      if (boardContainerRef.current) {
        const containerWidth = boardContainerRef.current.clientWidth;
        // On mobile, use more available space (up to 95% of screen width)
        const isMobile = window.innerWidth < 768;
        const newWidth = isMobile 
          ? Math.min(containerWidth * 0.95, window.innerWidth * 0.9) 
          : Math.min(containerWidth * 0.95, 550); // Increased from 400 to 550 for wider screens
        setBoardWidth(newWidth);
      }
    }
    
    // Initial size
    updateBoardSize();
    
    // Update when window resizes
    window.addEventListener('resize', updateBoardSize);
    return () => window.removeEventListener('resize', updateBoardSize);
  }, []);

  useEffect(() => {
    setFen(game.fen());
    setHistory(prev => {
      // Only add to history if it's a new move
      if (prev.length === 0 || prev[prev.length - 1] !== game.fen()) {
        return [...prev, game.fen()];
      }
      return prev;
    });
    setCurrentPosition(history.length);
  }, [game]);
  
  // Handle keyboard events for arrow key navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!gameImported) return;
      
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevMove();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextMove();
      }
    }
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [gameImported, currentPosition, history.length]);

  // Effect to scroll to the current move when position changes
  useEffect(() => {
    if (gameImported && currentMoveRef.current && moveHistoryContainerRef.current) {
      const container = moveHistoryContainerRef.current;
      const activeRow = currentMoveRef.current;
      
      // Calculate the position to scroll to (center the active row in the container)
      const containerHeight = container.clientHeight;
      const rowTop = activeRow.offsetTop;
      const rowHeight = activeRow.clientHeight;
      
      // Scroll the container to center the active row
      container.scrollTo({
        top: rowTop - containerHeight / 2 + rowHeight / 2,
        behavior: 'smooth'
      });
    }
  }, [currentPosition, gameImported]);

  function resetBoard() {
    const newGame = new Chess();
    setGame(newGame);
    setHistory([newGame.fen()]);
    setCurrentPosition(0);
    setPgn('');
    setGameImported(false);
    setMoveHistory([]);
  }

  function navigateHistory(index: number) {
    if (index >= 0 && index < history.length) {
      setCurrentPosition(index);
      const historicalGame = new Chess(history[index]);
      setFen(historicalGame.fen());
    }
  }

  function nextMove() {
    navigateHistory(currentPosition + 1);
  }

  function prevMove() {
    navigateHistory(currentPosition - 1);
  }
  
  function handlePgnImport() {
    try {
      const newGame = new Chess();
      newGame.loadPgn(pgn);
      
      // Extract move history from the game
      const moves = newGame.history({ verbose: true });
      const fenPositions = [new Chess().fen()]; // Initial position FEN
      const moveHistoryWithFen: ChessMove[] = [];
      
      // Start from a fresh game at the initial position
      const replayGame = new Chess();
      
      // Replay each move and store the FEN after each move
      for (let i = 0; i < moves.length; i++) {
        const move = moves[i];
        replayGame.move({ from: move.from, to: move.to, promotion: move.promotion });
        moveHistoryWithFen.push({
          from: move.from,
          to: move.to,
          san: move.san,
          fen: replayGame.fen()
        });
        fenPositions.push(replayGame.fen());
      }
      
      // Set the game states
      setHistory(fenPositions);
      setMoveHistory(moveHistoryWithFen);
      // Set to the initial position (index 0)
      setCurrentPosition(0); 
      setFen(fenPositions[0]); // Show initial position
      setGameImported(true);
    } catch (error) {
      alert('Invalid PGN format. Please check your input and try again.');
    }
  }
  
  function goToMove(index: number) {
    // Add 1 because index 0 in history is the initial position
    navigateHistory(index + 1);
  }

  return (
    <div className="flex flex-col md:flex-row w-full max-w-6xl mx-auto gap-6">
      {/* Chessboard - full width on mobile, half on desktop */}
      <div className="w-full md:w-1/2">
        <div className="w-full flex justify-center">
          <div ref={boardContainerRef} className="w-full max-w-[95vw] md:max-w-none flex justify-center items-center">
            <Chessboard 
              id="ChessAnalysis" 
              position={fen} 
              boardWidth={boardWidth}
              ref={chessboardRef}
              customBoardStyle={{
                borderRadius: '4px',
                boxShadow: '0 5px 15px rgba(0, 0, 0, 0.5)'
              }}
              customDarkSquareStyle={{ backgroundColor: '#4b7399' }}
              customLightSquareStyle={{ backgroundColor: '#eae9d2' }}
              areArrowsAllowed={false}
              arePiecesDraggable={false}
            />
          </div>
        </div>
        
        {/* Navigation buttons - only shown when game is imported */}
        {gameImported && (
          <div className="mt-4 flex justify-center gap-4">
            <button 
              onClick={prevMove}
              disabled={currentPosition <= 0}
              className={`px-4 py-2 rounded flex items-center ${
                currentPosition <= 0 
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed' 
                  : 'bg-blue-500 text-white hover:bg-blue-600 transition'
              }`}
              aria-label="Previous Move"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
              <span className="ml-1">Prev</span>
            </button>
            <button 
              onClick={nextMove}
              disabled={currentPosition >= history.length - 1}
              className={`px-4 py-2 rounded flex items-center ${
                currentPosition >= history.length - 1 
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed' 
                  : 'bg-blue-500 text-white hover:bg-blue-600 transition'
              }`}
              aria-label="Next Move"
            >
              <span className="mr-1">Next</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          </div>
        )}
      </div>
      
      {/* PGN Import or Move History - full width on mobile, half on desktop */}
      <div className="w-full md:w-1/2 p-4 bg-gray-800 rounded-lg flex flex-col items-center mt-6 md:mt-0">
        {!gameImported ? (
          // PGN Import Panel
          <>
            <h2 className="text-xl font-bold mb-4 text-gray-100">Import Game</h2>
            <div className="mb-4 w-full">
              <label htmlFor="pgn-input" className="block text-sm font-medium text-gray-300 mb-1 text-center">
                Enter PGN (Portable Game Notation)
              </label>
              <textarea 
                id="pgn-input"
                value={pgn}
                onChange={(e) => setPgn(e.target.value)}
                className="w-full h-40 md:h-64 p-3 border border-gray-600 rounded shadow-sm 
                          bg-gray-700 text-gray-100
                          focus:ring-blue-500 focus:border-blue-500"
                placeholder="Paste your PGN here... e.g.,
1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6"
              ></textarea>
            </div>
            <button 
              onClick={handlePgnImport}
              className="px-8 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition mx-auto"
              disabled={!pgn.trim()}
            >
              Import Game
            </button>
          </>
        ) : (
          // Move History Panel
          <>
            <div className="w-full">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-100">Move History</h2>
                <button 
                  onClick={resetBoard}
                  className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition text-sm"
                >
                  New Game
                </button>
              </div>
              
              <div ref={moveHistoryContainerRef} className="bg-gray-700 rounded border border-gray-600 h-60 md:h-80 overflow-y-auto">
                <table className="w-full text-gray-200">
                  <thead className="bg-gray-800">
                    <tr>
                      <th className="py-2 px-4 text-left">#</th>
                      <th className="py-2 px-4 text-left">White</th>
                      <th className="py-2 px-4 text-left">Black</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: Math.ceil(moveHistory.length / 2) }).map((_, idx) => {
                      const moveNumber = idx + 1;
                      const whiteMove = moveHistory[idx * 2];
                      const blackMove = moveHistory[idx * 2 + 1];
                      
                      return (
                        <tr 
                          key={idx} 
                          ref={(currentPosition === idx * 2 + 1 || currentPosition === idx * 2 + 2) ? currentMoveRef : null}
                          className={`border-b border-gray-600 ${
                            (currentPosition === idx * 2 + 1 || currentPosition === idx * 2 + 2) 
                              ? 'bg-blue-900' : ''
                          }`}
                        >
                          <td className="py-2 px-4">{moveNumber}.</td>
                          <td 
                            className={`py-2 px-4 cursor-pointer hover:underline ${
                              currentPosition === idx * 2 + 1 ? 'font-bold text-blue-400' : ''
                            }`}
                            onClick={() => goToMove(idx * 2)}
                          >
                            {whiteMove?.san}
                          </td>
                          <td 
                            className={`py-2 px-4 cursor-pointer hover:underline ${
                              currentPosition === idx * 2 + 2 ? 'font-bold text-blue-400' : ''
                            }`}
                            onClick={() => blackMove && goToMove(idx * 2 + 1)}
                          >
                            {blackMove?.san}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              
              <div className="mt-4 text-center text-sm text-gray-400">
                <p>Use arrow keys (←/→) or buttons to navigate moves</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
