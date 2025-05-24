import { useState, useRef, useEffect, useCallback, useMemo, memo, forwardRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import pgnParser from 'pgn-parser';

interface ChessAnalysisProps {}

// Add sticker interface
interface ChessMoveSticker {
  square: string; // e.g., "e4"
  type: 'best'| 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'brilliant' | 'great' | 'miss' | 'forced';
  color?: string;
  icon?: string;
}

// Context-aware move classification interfaces
interface MaterialCount {
  white: { pawns: number; knights: number; bishops: number; rooks: number; queens: number; king: number };
  black: { pawns: number; knights: number; bishops: number; rooks: number; queens: number; king: number };
}

interface GameStateContext {
  evaluation: number; // In centipawns from white's perspective
  state: 'winning' | 'better' | 'equal' | 'worse' | 'losing';
  materialBalance: number; // Material difference in points
}

interface MoveAnalysis {
  centipawnLoss: number;
  materialChange: number;
  gameStateBefore: GameStateContext;
  gameStateAfter: GameStateContext;
  isBestMove: boolean;
  isForced: boolean;
  isSacrifice: boolean;
  classification: ChessMoveSticker['type'];
  confidence: number; // 0-1 scale
}

interface ChessMove {
  from: string;
  to: string;
  san: string;
  fen: string;
  explanation?: string; // Add explanation field
  sticker?: ChessMoveSticker; // Add sticker field
}

// Added interface for evaluation
interface Evaluation {
  score: number;
  mate: number | null;
  loading: boolean;
  error?: string; // Add optional error field
}

// Add proper typing for the Stockfish worker
interface StockfishWorker extends Worker {
  currentFen: string | null;
  hasMateScore: boolean;
}

// Memoized EvaluationBar component - only re-renders when props change
const EvaluationBar = memo(function EvaluationBar({
  evaluation,
  boardHeight,
  flipped
}: {
  evaluation: Evaluation;
  boardHeight: number;
  flipped?: boolean;
}) {
  // Calculate styles based on evaluation (memoized)
  // Evaluation is always from White's perspective: positive = White advantage, negative = Black advantage
  const styles = useMemo(() => {
    if (evaluation.mate !== null) {
      const mateValue = evaluation.mate > 0 ? 5 : -5; // Max out the bar for mate
      const whitePercentage = ((mateValue + 5) / 10) * 100;
      if (flipped) {
        return {
          black: { height: `${whitePercentage}%` },
          white: { height: `${100 - whitePercentage}%` }
        };
      }
      return {
        white: { height: `${whitePercentage}%` },
        black: { height: `${100 - whitePercentage}%` }
      };
    }
    const clampedScore = Math.max(Math.min(evaluation.score, 5), -5);
    const whitePercentage = ((clampedScore + 5) / 10) * 100;
    if (flipped) {
      return {
        black: { height: `${whitePercentage}%` },
        white: { height: `${100 - whitePercentage}%` }
      };
    }
    return {
      white: { height: `${whitePercentage}%` },
      black: { height: `${100 - whitePercentage}%` }
    };
  }, [evaluation.score, evaluation.mate, flipped]);

  // Format evaluation text (memoized)
  // Always from White's perspective: + = White advantage, - = Black advantage
  const evaluationText = useMemo(() => {
    if (evaluation.loading) return "...";
    if (evaluation.error) return `Error: ${evaluation.error}`;
    if (evaluation.mate !== null) {
      const sign = evaluation.mate > 0 ? '+' : '-';
      return `${sign}M${Math.abs(evaluation.mate)}`;
    }
    const sign = evaluation.score >= 0 ? '+' : '-';
    return `${sign}${Math.abs(evaluation.score).toFixed(1)}`;
  }, [evaluation.loading, evaluation.score, evaluation.mate, evaluation.error]);

  // Determine text position class (memoized)
  // Always from White's perspective
  const textPositionClass = useMemo(() => {
    const isWhiteAdvantage = evaluation.score >= 0 || (evaluation.mate !== null && evaluation.mate > 0);
    if (!flipped) {
      return isWhiteAdvantage 
        ? 'bottom-[-22px] text-black bg-white/90' 
        : 'top-[-22px] text-white bg-black/90';
    } else {
      // When flipped, invert the text position
      return isWhiteAdvantage 
        ? 'top-[-22px] text-white bg-black/90' 
        : 'bottom-[-22px] text-black bg-white/90';
    }
  }, [evaluation.score, evaluation.mate, flipped]);

  return (
    <div className="relative py-2">
      <div 
        className="relative w-8 bg-gray-800"
        style={{ height: `${boardHeight}px` }}
      >
        <div 
          className={`absolute ${flipped ? 'top-0' : 'bottom-0'} w-full bg-white transition-all duration-300 ease-out`}
          style={flipped ? styles.black : styles.white}
        ></div>
        <div 
          className={`absolute ${flipped ? 'bottom-0' : 'top-0'} w-full bg-black transition-all duration-300 ease-out`}
          style={flipped ? styles.white : styles.black}
        ></div>
        <div className="absolute top-1/2 w-full border-t border-gray-400"></div>
      </div>
      {/* Evaluation text - positioned above/below the bar */}
      <div 
        className={`absolute w-full text-center text-xs font-bold px-1 py-1 rounded-sm shadow-md ${textPositionClass}`}
      >
        {evaluationText}
      </div>
    </div>
  );
});

// Custom Square Renderer for stickers
const CustomSquareRenderer = forwardRef<HTMLDivElement, any>((props, ref) => {
  const {
    children,
    square,
    squareColor,
    style,
    sticker
  } = props;
  // Get sticker styling based on type
  const getStickerStyle = () => {
    if (!sticker) return {};
      const baseStyle = {
      position: "absolute" as const,
      right: 2,
      top: 2,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: 28,
      width: 28,
      borderRadius: 14,
      color: "#fff",
      fontSize: 12,
      fontWeight: "bold",
      zIndex: 10,
      pointerEvents: "none" as const,
      textShadow: "0 1px 2px rgba(0,0,0,0.5)"
    };
    
    switch (sticker.type) {
      case 'best':
        return { ...baseStyle, backgroundColor: '#10b981' }; // Green background
      case 'excellent':
        return { ...baseStyle, backgroundColor: '#10b981' }; // Green background  
      case 'good':
        return { ...baseStyle, backgroundColor: '#059669' }; // Slightly darker green
      case 'inaccuracy':
        return { ...baseStyle, backgroundColor: '#f59e0b' }; // Yellow background
      case 'mistake':
        return { ...baseStyle, backgroundColor: '#f97316' }; // Orange background
      case 'blunder':
        return { ...baseStyle, backgroundColor: '#ef4444' }; // Red background
      case 'brilliant':
        return { ...baseStyle, backgroundColor: '#06b6d4' }; // Cyan background
      case 'great':
        return { ...baseStyle, backgroundColor: '#3b82f6' }; // Blue background
      case 'miss':
        return { ...baseStyle, backgroundColor: '#dc2626' }; // Red background
      case 'forced':
        return { ...baseStyle, backgroundColor: '#15803d' }; // Saturated green background
      default:
        return { ...baseStyle, backgroundColor: '#6b7280' };
    }
  };
  // Get sticker content
  const getStickerContent = () => {
    if (!sticker) return null;
    if (sticker.icon) return sticker.icon;
    
    switch (sticker.type) {      case 'best':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        );
      case 'excellent':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7.5 11L10 13.5l6.5-6.5L18 8.5l-8 8L5.5 12l2-1z"/>
          </svg>
        );
      case 'good':
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        );
      case 'inaccuracy':
        return '?!';
      case 'mistake':
        return '?';
      case 'blunder':
        return '??';
      case 'brilliant':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        );
      case 'great':
        return '!';
      case 'miss':
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        );
      case 'forced':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/>
          </svg>
        );
      default: return '•';
    }
  };

  return (
    <div ref={ref} style={{
      ...style,
      position: "relative"
    }}>
      {children}
      {sticker && (
        <div style={getStickerStyle()}>
          {getStickerContent()}
        </div>
      )}
    </div>
  );
});

// Memoized Chessboard component
const MemoizedChessboard = memo(function MemoizedChessboard({
  position,
  width,
  orientation,
  stickers = []
}: {
  position: string;
  width: number;
  orientation?: 'white' | 'black';
  stickers?: Array<{ square: string; sticker: ChessMoveSticker }>;
}) {
  // Create a map of stickers by square for easy lookup
  const stickerMap = useMemo(() => {
    const map: Record<string, ChessMoveSticker> = {};
    stickers.forEach(({ square, sticker }) => {
      map[square] = sticker;
    });
    return map;
  }, [stickers]);

  // Custom square component that includes stickers
  const CustomSquareWithSticker = useCallback((props: any) => {
    const sticker = stickerMap[props.square];
    return <CustomSquareRenderer {...props} sticker={sticker} />;
  }, [stickerMap]);

  return (
    <Chessboard 
      id="ChessAnalysis" 
      position={position} 
      boardWidth={width}
      boardOrientation={orientation || 'white'}
      customSquare={CustomSquareWithSticker}
      customBoardStyle={{
        borderRadius: '4px',
        boxShadow: '0 5px 15px rgba(0, 0, 0, 0.5)'
      }}
      customDarkSquareStyle={{ backgroundColor: '#4b7399' }}
      customLightSquareStyle={{ backgroundColor: '#eae9d2' }}
      areArrowsAllowed={false}
      arePiecesDraggable={false}
      showBoardNotation={false}
    />
  );
});



export default function ChessAnalysis({}: ChessAnalysisProps) {
  const [game, setGame] = useState(new Chess());
  const [fen, setFen] = useState(game.fen());
  const [history, setHistory] = useState<string[]>([]);
  const [moveHistory, setMoveHistory] = useState<ChessMove[]>([]);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [pgn, setPgn] = useState('');
  const [gameImported, setGameImported] = useState(false);
  const [boardWidth, setBoardWidth] = useState(400);
  const [boardHeight, setBoardHeight] = useState(400); // Add state for board height
  const [currentMoveExplanation, setCurrentMoveExplanation] = useState<string>("");
  // Added state for Stockfish and evaluation
  const [stockfish, setStockfish] = useState<any>(null);
  const [evaluation, setEvaluation] = useState<Evaluation>({ score: 0, mate: null, loading: false });
  const [engineDepth, setEngineDepth] = useState(15); // Depth for analysis
  const [boardFlipped, setBoardFlipped] = useState(false);
  // State for move stickers
  const [moveStickers, setMoveStickers] = useState<Array<{ square: string; sticker: ChessMoveSticker }>>([]);
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const chessboardRef = useRef(null);
  
  // Refs for scrolling to the current move
  const moveHistoryContainerRef = useRef<HTMLDivElement>(null);
  const currentMoveRef = useRef<HTMLTableRowElement>(null);

  // Initialize Stockfish WebAssembly
  useEffect(() => {
    // Import Stockfish from the public folder
    if (typeof window !== 'undefined' && !stockfish) {
      // Create a web worker from the stockfish.js file
      const worker = new Worker('/stockfish/stockfish.js') as StockfishWorker & { evalCache?: Map<string, Evaluation> };
      
      // Keep track of the latest FEN being analyzed
      worker.currentFen = null;
      // Track whether we're currently processing a mate score
      worker.hasMateScore = false;
      
      setStockfish(worker);
      
      // Initialize Stockfish
      worker.addEventListener('message', (e) => {
        const message = e.data;
        if (!message) return;
        
        // Parse evaluation information from Stockfish output
        // Only proceed if the message contains a recognizable score update
        if (message.includes('info depth') && (message.includes(' score cp ') || message.includes(' score mate '))) {
          try {
            // Get the FEN that was being analyzed when this evaluation was produced
            const fenBeingEvaluated = worker.currentFen; // This is the FEN Stockfish was told to analyze
            
            if (!fenBeingEvaluated) {
              console.warn('Stockfish evaluation: worker.currentFen is not set. Cannot process score message:', message);
              // To prevent getting stuck on loading if this unexpected state occurs:
              setEvaluation(prev => ({ ...prev, loading: false, error: 'Internal: worker.currentFen missing' }));
              return; 
            }

            const fenParts = fenBeingEvaluated.split(' ');
            if (fenParts.length < 2) { // Basic validation for FEN structure
                console.error('Stockfish evaluation: Invalid FEN string from worker.currentFen:', fenBeingEvaluated);
                setEvaluation(prev => ({ ...prev, loading: false, error: 'Internal: Invalid FEN' }));
                return;
            }
            const turn = fenParts[1]; // 'w' or 'b'
              if (message.includes('score cp ')) {
              // Normal score (not a mate) - only update if we weren't previously showing a mate score
              // This prevents flickering between mate and regular scores during analysis
              if (!worker.hasMateScore) {
                const scoreMatch = message.match(/score cp (-?\d+)/);
                if (scoreMatch) {
                  let score = parseInt(scoreMatch[1]);
                  // Adjust score based on whose turn it is.
                  // Stockfish score is from the perspective of the current player.
                  // We want to store it from White's perspective.
                  if (turn === 'b') {
                    score = -score;
                  }
                  const newEval = { 
                    score: score / 100, // Convert centipawns to pawns
                    mate: null, 
                    loading: false 
                  };
                  setEvaluation(newEval);
                } else {
                  console.warn("Stockfish evaluation: CP regex mismatch for message:", message);
                  setEvaluation(prev => ({ ...prev, loading: false, error: 'CP regex mismatch' }));
                }
              } else {
                // A mate score is active, this cp score is ignored.
                // Ensure loading is false if it was true for some reason.
                setEvaluation(prev => ({ ...prev, loading: false }));
              }
            } else if (message.includes('score mate ')) {
              // Mate score - these have priority over regular scores
              const mateMatch = message.match(/score mate (-?\d+)/);
              if (mateMatch) {
                let mate = parseInt(mateMatch[1]);
                worker.hasMateScore = true; 

                // Adjust mate based on whose turn it is.
                // Stockfish mate is from the perspective of the current player.
                // We want to store it from White's perspective.
                if (turn === 'b') {
                  mate = -mate;
                }

                const newEval = { 
                  score: mate > 0 ? 10 : -10, 
                  mate: mate, 
                  loading: false 
                };
                setEvaluation(newEval);
              } else {
                console.warn("Stockfish evaluation: Mate regex mismatch for message:", message);
                setEvaluation(prev => ({ ...prev, loading: false, error: 'Mate regex mismatch' }));
              }
            }
          } catch (e) {
            console.error('Error parsing Stockfish evaluation:', e);
            setEvaluation(prev => ({ ...prev, score:0, mate:null, loading: false, error: 'Parsing failed' }));
          }
        }
      });
      
      // Configure Stockfish
      worker.postMessage('uci');
      worker.postMessage('setoption name MultiPV value 1');
      worker.postMessage('isready');
    }
    
    return () => {
      if (stockfish) {
        stockfish.postMessage('quit');
      }
    };
  }, []); // Remove fen from the dependency array

  // Add debounce function to prevent too frequent updates
  const debounce = (func: Function, delay: number) => {
    let timer: ReturnType<typeof setTimeout>;
    return (...args: any[]) => {
      clearTimeout(timer);
      timer = setTimeout(() => func(...args), delay);
    };
  };

  // Function to evaluate the current position with debouncing
  const evaluatePosition = useCallback(debounce((currentFen: string) => {
    if (!stockfish) return;
    setEvaluation(prev => ({ ...prev, loading: true }));
    stockfish.postMessage('stop'); // Stop any ongoing analysis
    stockfish.postMessage('position fen ' + currentFen);
    stockfish.postMessage(`go depth ${engineDepth}`);
    // Always set the worker's currentFen to the FEN being evaluated
    stockfish.currentFen = currentFen;
  }, 250), [stockfish, engineDepth]);

  // Effect to evaluate position when fen changes (always use latest FEN)
  useEffect(() => {
    if (stockfish && fen) {
      stockfish.hasMateScore = false;
      // Always evaluate the current FEN
      evaluatePosition(fen);
    }
  }, [fen, stockfish, evaluatePosition]);

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
        
        // Chess boards are square, so height = width
        setBoardWidth(newWidth);
        setBoardHeight(newWidth);
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

  // Evaluate position when fen changes
  useEffect(() => {
    if (stockfish && fen) {
      // Reset the mate score tracker when navigating to a new position
      stockfish.hasMateScore = false;
      // Always evaluate the current FEN
      evaluatePosition(fen);
    }
  }, [fen, stockfish, evaluatePosition]);

  function resetBoard() {
    const newGame = new Chess();
    setGame(newGame);
    setHistory([newGame.fen()]);
    setCurrentPosition(0);
    setPgn('');
    setGameImported(false);
    setMoveHistory([]);
    setEvaluation({ score: 0, mate: null, loading: false });
  }

  function navigateHistory(index: number) {
    if (index >= 0 && index < history.length) {
      setCurrentPosition(index);
      const historicalGame = new Chess(history[index]);
      setFen(historicalGame.fen());
      
      // Update move explanation
      if (index === 0) {
        // Initial position has no explanation
        setCurrentMoveExplanation("");
      } else {
        // Get the explanation from the move that led to this position
        const moveIndex = index - 1; // Adjust index (initial position is at 0, first move is at index 0 in moveHistory)
        if (moveHistory[moveIndex] && moveHistory[moveIndex].explanation) {
          setCurrentMoveExplanation(moveHistory[moveIndex].explanation || "");
        } else {
          setCurrentMoveExplanation("");
        }
      }
    }
  }

  function nextMove() {
    navigateHistory(currentPosition + 1);
  }

  function prevMove() {
    navigateHistory(currentPosition - 1);
  }
  
  function handlePgnImport() {
    console.log("Attempting to import PGN:", pgn); // Added for debugging
    try {
      // Pre-process PGN to handle variations followed immediately by game termination markers
      let processedPgn = pgn;
      // Add a space between a closing parenthesis and a game result marker if missing
      // Regex: finds a closing parenthesis, optional whitespace, then a game result, and inserts a space
      processedPgn = processedPgn.replace(/(\))\s*(\*|1-0|0-1|1\/2-1\/2)/g, '$1 $2');

      // Use pgn-parser to parse the PGN
      const parsedPgn = pgnParser.parse(processedPgn);
      
      console.log("Parsed PGN object:", parsedPgn); // Added for debugging

      if (!parsedPgn || !parsedPgn.length) {
        console.error("pgnParser.parse returned an empty or invalid result:", parsedPgn);
        throw new Error('Invalid PGN format: Parser returned no games.');
      }
      
      const pgnGame = parsedPgn[0]; // Get the first game from the parsed PGN
      
      // Initialize a new game
      const newGame = new Chess();
      
      // Extract move history from the parsed PGN
      const fenPositions = [new Chess().fen()]; // Initial position FEN
      const moveHistoryWithFen: ChessMove[] = [];
      
      // Start from a fresh game at the initial position
      const replayGame = new Chess();
      
      // Apply headers if available
      if (pgnGame.headers) {
        pgnGame.headers.forEach(header => {
          newGame.header(header.name, header.value);
        });
      }
      
      // Replay each move from the parsed PGN
      if (pgnGame.moves) {
        for (const pgnMove of pgnGame.moves) {
          // Skip RAVs (variations) for now
          if (!pgnMove.move) continue;
          
          try {
            // Store the current FEN before making the move
            const prevFen = replayGame.fen();
            
            // Make the move - convert PGN move to a move object that chess.js can understand
            const moveObj = replayGame.move(pgnMove.move);
            
            if (!moveObj) {
              console.error('Invalid move:', pgnMove.move);
              continue;
            }
            
            const currentFen = replayGame.fen();
            
            // Generate an explanation for this move
            const explanation = analyzeMoveAndGenerateExplanation(
              prevFen,
              currentFen,
              { 
                from: moveObj.from, 
                to: moveObj.to, 
                san: moveObj.san 
              }
            );
            
            // Store move with explanation
            moveHistoryWithFen.push({
              from: moveObj.from,
              to: moveObj.to,
              san: moveObj.san,
              fen: currentFen,
              explanation: explanation
            });
            
            // Add comments if they exist in the PGN
            if (pgnMove.comments && pgnMove.comments.length) {
              const comment = pgnMove.comments[0];
              // Use 'as any' to safely access 'text' property if it exists
              moveHistoryWithFen[moveHistoryWithFen.length - 1].explanation = (typeof comment === 'object' && (comment as any).text) ? (comment as any).text : String(comment);
            }
            
            fenPositions.push(currentFen);
          } catch (moveError) {
            console.error('Error applying move:', pgnMove.move, moveError);
          }
        }
      }
      
      // Set the game states
      setHistory(fenPositions);
      setMoveHistory(moveHistoryWithFen);
      // Set to the initial position (index 0)
      setCurrentPosition(0); 
      setFen(fenPositions[0]); // Show initial position
      setCurrentMoveExplanation(""); // Clear explanation for initial position
      setGameImported(true);
    } catch (error) {
      console.error('PGN parsing error:', error);
      alert('Invalid PGN format. Please check your input and try again.');
    }
  }
  
  function goToMove(index: number) {
    // Add 1 because index 0 in history is the initial position
    navigateHistory(index + 1);
  }
  // Function to add a sticker to a move
  function addMoveSticker(square: string, stickerType: ChessMoveSticker['type']) {
    const newSticker: ChessMoveSticker = {
      square,
      type: stickerType
    };
    
    setMoveStickers(prev => {
      // Remove existing sticker on this square if any
      const filtered = prev.filter(s => s.square !== square);
      return [...filtered, { square, sticker: newSticker }];
    });
    
    // Also add to the move history if we're viewing a specific move
    if (gameImported && currentPosition > 0) {
      const moveIndex = currentPosition - 1;
      setMoveHistory(prev => {
        const updated = [...prev];
        if (updated[moveIndex]) {
          updated[moveIndex] = { ...updated[moveIndex], sticker: newSticker };
        }
        return updated;
      });
    }
  }

  // Function to remove sticker from a square
  function removeMoveSticker(square: string) {
    setMoveStickers(prev => prev.filter(s => s.square !== square));
    
    // Also remove from move history
    if (gameImported && currentPosition > 0) {
      const moveIndex = currentPosition - 1;
      setMoveHistory(prev => {
        const updated = [...prev];
        if (updated[moveIndex]) {
          updated[moveIndex] = { ...updated[moveIndex] };
          delete updated[moveIndex].sticker;
        }
        return updated;
      });
    }
  }

  // Helper functions for sticker display
  function getStickerColor(type: ChessMoveSticker['type']): string {
    switch (type) {
      case 'best': return '#10b981';
      case 'excellent': return '#10b981';
      case 'good': return '#059669';
      case 'inaccuracy': return '#f59e0b';
      case 'mistake': return '#f97316';
      case 'blunder': return '#ef4444';
      case 'brilliant': return '#06b6d4';
      case 'great': return '#3b82f6';
      case 'miss': return '#dc2626';
      case 'forced': return '#15803d';
      default: return '#6b7280';
    }
  }

  function getStickerSymbol(type: ChessMoveSticker['type']): string {
    switch (type) {
      case 'best': return '⭐';
      case 'excellent': return '👍';
      case 'good': return '✓';
      case 'inaccuracy': return '?!';
      case 'mistake': return '?';
      case 'blunder': return '??';
      case 'brilliant': return '⭐';
      case 'great': return '!';
      case 'miss': return '✗';
      case 'forced': return '→';
      default: return '•';
    }
  }

  // Function to manually assign sticker to current move
  function assignStickerToCurrentMove(stickerType: ChessMoveSticker['type']) {
    if (!gameImported || currentPosition <= 0) return;
    
    const moveIndex = currentPosition - 1;
    const move = moveHistory[moveIndex];
    if (!move) return;
    
    const newSticker: ChessMoveSticker = {
      square: move.to,
      type: stickerType
    };
    
    setMoveHistory(prev => {
      const updated = [...prev];
      updated[moveIndex] = { ...updated[moveIndex], sticker: newSticker };
      return updated;
    });
  }
  // Advanced analysis system with real Stockfish integration
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);

  // Function to analyze a position with Stockfish and return evaluation
  function analyzePositionWithStockfish(fen: string): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!stockfish) {
        reject(new Error('Stockfish not available'));
        return;
      }

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Analysis timeout'));
        }
      }, 5000); // 5 second timeout

      const messageHandler = (e: MessageEvent) => {
        const message = e.data;
        if (!message || resolved) return;

        if (message.includes('info depth') && message.includes(' score ')) {
          const fenParts = fen.split(' ');
          const turn = fenParts[1];
          
          let evaluation = 0;
          
          if (message.includes('score cp ')) {
            const scoreMatch = message.match(/score cp (-?\d+)/);
            if (scoreMatch) {
              evaluation = parseInt(scoreMatch[1]) / 100;
              if (turn === 'b') evaluation = -evaluation;
            }
          } else if (message.includes('score mate ')) {
            const mateMatch = message.match(/score mate (-?\d+)/);
            if (mateMatch) {
              evaluation = parseInt(mateMatch[1]) > 0 ? 10 : -10;
              if (turn === 'b') evaluation = -evaluation;
            }
          }

          // Wait for a reasonable depth before accepting the result
          const depthMatch = message.match(/depth (\d+)/);
          if (depthMatch && parseInt(depthMatch[1]) >= 8) {
            resolved = true;
            clearTimeout(timeout);
            stockfish.removeEventListener('message', messageHandler);
            resolve(evaluation);
          }
        }
      };

      stockfish.addEventListener('message', messageHandler);
      stockfish.postMessage('stop');
      stockfish.postMessage('position fen ' + fen);
      stockfish.postMessage('go depth 10');
    });
  }

  // Enhanced auto-assignment with real Stockfish analysis
  async function autoAssignStickersWithAnalysis() {
    if (!gameImported || !stockfish || isAnalyzing) return;

    setIsAnalyzing(true);
    setAnalysisProgress(0);

    try {
      const analyzedMoves = [];
      
      for (let i = 0; i < moveHistory.length; i++) {
        const move = moveHistory[i];
        const beforeFen = i === 0 ? new Chess().fen() : history[i];
        const afterFen = move.fen;
        
        // Update progress
        setAnalysisProgress((i / moveHistory.length) * 100);
        
        try {
          // Analyze both positions
          const [evalBefore, evalAfter] = await Promise.all([
            analyzePositionWithStockfish(beforeFen),
            analyzePositionWithStockfish(afterFen)
          ]);
          
          const beforeGame = new Chess(beforeFen);
          const afterGame = new Chess(afterFen);
          
          const materialBefore = countMaterial(beforeGame);
          const materialAfter = countMaterial(afterGame);
          const materialChange = getMaterialChange(materialBefore, materialAfter);
          
          // Calculate centipawn loss (from the perspective of the player who moved)
          const playerColor = beforeGame.turn();
          let centipawnLoss;
          if (playerColor === 'w') {
            centipawnLoss = Math.max(0, evalBefore - evalAfter);
          } else {
            centipawnLoss = Math.max(0, -evalBefore - (-evalAfter));
          }
          
          const gameStateBefore = createGameStateContext(evalBefore, materialBefore);
          const gameStateAfter = createGameStateContext(evalAfter, materialAfter);
          
          // Detect special move types
          const isBestMove = centipawnLoss < 0.15;
          const isForced = beforeGame.inCheck() || afterGame.isCheckmate() || beforeGame.moves().length <= 2;
          const isSacrifice = materialChange < -1 && centipawnLoss < 1;
          
          const classification = classifyMoveBasedOnAnalysis(
            centipawnLoss,
            materialChange,
            gameStateBefore,
            gameStateAfter,
            isBestMove,
            isForced,
            isSacrifice
          );
          
          analyzedMoves.push({
            ...move,
            sticker: { square: move.to, type: classification.type }
          });
          
        } catch (error) {
          console.warn(`Failed to analyze move ${i + 1}:`, error);
          // Keep move without sticker if analysis fails
          analyzedMoves.push(move);
        }
        
        // Small delay to prevent overwhelming Stockfish
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      setMoveHistory(analyzedMoves);
      setAnalysisProgress(100);
      
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setIsAnalyzing(false);
      setTimeout(() => setAnalysisProgress(0), 2000);
    }
  }
  function countMaterial(game: Chess): MaterialCount {
    const pieces = { pawns: 0, knights: 0, bishops: 0, rooks: 0, queens: 0, king: 0 };
    const material: MaterialCount = {
      white: { ...pieces },
      black: { ...pieces }
    };
    
    const board = game.board();
    board.forEach(row => {
      row.forEach(square => {
        if (square) {
          const color = square.color === 'w' ? 'white' : 'black';
          switch (square.type) {
            case 'p': material[color].pawns++; break;
            case 'n': material[color].knights++; break;
            case 'b': material[color].bishops++; break;
            case 'r': material[color].rooks++; break;
            case 'q': material[color].queens++; break;
            case 'k': material[color].king++; break;
          }
        }
      });
    });
    
    return material;
  }

  function calculateMaterialValue(material: MaterialCount['white']): number {
    return material.pawns * 1 + 
           material.knights * 3 + 
           material.bishops * 3.25 + 
           material.rooks * 5 + 
           material.queens * 9;
  }

  function getMaterialChange(before: MaterialCount, after: MaterialCount): number {
    const beforeWhite = calculateMaterialValue(before.white);
    const beforeBlack = calculateMaterialValue(before.black);
    const afterWhite = calculateMaterialValue(after.white);
    const afterBlack = calculateMaterialValue(after.black);
    
    return (afterWhite - afterBlack) - (beforeWhite - beforeBlack);
  }

  // Game state analysis
  function analyzeGameState(evaluation: number): GameStateContext['state'] {
    if (evaluation >= 3) return 'winning';
    if (evaluation >= 1) return 'better';
    if (evaluation >= -1) return 'equal';
    if (evaluation >= -3) return 'worse';
    return 'losing';
  }

  function createGameStateContext(evaluation: number, material: MaterialCount): GameStateContext {
    const whiteValue = calculateMaterialValue(material.white);
    const blackValue = calculateMaterialValue(material.black);
    
    return {
      evaluation,
      state: analyzeGameState(evaluation),
      materialBalance: whiteValue - blackValue
    };
  }

  // Core classification algorithm
  function classifyMoveBasedOnAnalysis(
    centipawnLoss: number,
    materialChange: number,
    gameStateBefore: GameStateContext,
    gameStateAfter: GameStateContext,
    isBestMove: boolean,
    isForced: boolean,
    isSacrifice: boolean
  ): { type: ChessMoveSticker['type']; confidence: number } {
    
    // Brilliant moves: Sacrifices that improve position significantly
    if (isSacrifice && centipawnLoss < 0.5 && materialChange < -1) {
      return { type: 'brilliant', confidence: 0.9 };
    }
    
    // Best moves: Objectively the strongest choice
    if (isBestMove || centipawnLoss < 0.1) {
      return { type: 'best', confidence: 0.95 };
    }
    
    // Forced moves: Only reasonable option
    if (isForced) {
      return { type: 'forced', confidence: 0.9 };
    }
    
    // Great moves: Very strong but not best
    if (centipawnLoss < 0.25) {
      return { type: 'great', confidence: 0.8 };
    }
    
    // Excellent moves: Strong moves with minimal loss
    if (centipawnLoss < 0.5) {
      return { type: 'excellent', confidence: 0.7 };
    }
    
    // Good moves: Reasonable with acceptable loss
    if (centipawnLoss < 1.0) {
      return { type: 'good', confidence: 0.6 };
    }
    
    // Context-aware classification for larger losses
    const isWinning = gameStateBefore.state === 'winning';
    const isLosing = gameStateBefore.state === 'losing';
    
    // Missed opportunities in winning positions
    if (isWinning && centipawnLoss > 2.0) {
      return { type: 'miss', confidence: 0.8 };
    }
    
    // Inaccuracies: Minor errors
    if (centipawnLoss < 2.0) {
      return { type: 'inaccuracy', confidence: 0.7 };
    }
    
    // Mistakes: Significant errors
    if (centipawnLoss < 4.0) {
      return { type: 'mistake', confidence: 0.8 };
    }
    
    // Blunders: Major errors that significantly worsen position
    return { type: 'blunder', confidence: 0.9 };
  }

  // Function to automatically assign stickers based on evaluation
  function autoAssignStickers() {
    if (!gameImported || !stockfish) return;

    // Analyze each move in the game
    const analyzedMoves = moveHistory.map((move, index) => {
      // For demonstration, we'll use simplified analysis
      // In a real implementation, you'd run Stockfish analysis for each position
      
      const beforeFen = index === 0 ? new Chess().fen() : history[index];
      const afterFen = move.fen;
      
      const beforeGame = new Chess(beforeFen);
      const afterGame = new Chess(afterFen);
      
      const materialBefore = countMaterial(beforeGame);
      const materialAfter = countMaterial(afterGame);
      const materialChange = getMaterialChange(materialBefore, materialAfter);
      
      // Simulate evaluations (in real implementation, use actual Stockfish analysis)
      const evalBefore = Math.random() * 4 - 2; // Random eval between -2 and 2
      const evalAfter = Math.random() * 4 - 2;
      const centipawnLoss = Math.max(0, evalBefore - evalAfter);
      
      const gameStateBefore = createGameStateContext(evalBefore, materialBefore);
      const gameStateAfter = createGameStateContext(evalAfter, materialAfter);
      
      // Detect special move types
      const isBestMove = centipawnLoss < 0.1;
      const isForced = beforeGame.inCheck() || afterGame.isCheckmate();
      const isSacrifice = materialChange < -1 && centipawnLoss < 1;
      
      const classification = classifyMoveBasedOnAnalysis(
        centipawnLoss,
        materialChange,
        gameStateBefore,
        gameStateAfter,
        isBestMove,
        isForced,
        isSacrifice
      );
      
      return {
        ...move,
        sticker: { square: move.to, type: classification.type }
      };
    });

    setMoveHistory(analyzedMoves);
  }
  // Update stickers when position changes
  useEffect(() => {
    if (gameImported) {
      // Show stickers for moves that have them
      const stickersToShow: Array<{ square: string; sticker: ChessMoveSticker }> = [];
      
      // Only show sticker for the current move (if it has one)
      if (currentPosition > 0 && currentPosition <= moveHistory.length) {
        const currentMoveIndex = currentPosition - 1;
        const currentMove = moveHistory[currentMoveIndex];
        if (currentMove && currentMove.sticker) {
          stickersToShow.push({ square: currentMove.to, sticker: currentMove.sticker });
        }
      }
      
      setMoveStickers(stickersToShow);
    } else {
      // Clear stickers when no game is imported
      setMoveStickers([]);
    }
  }, [currentPosition, moveHistory, gameImported]);

  // Helper function for evaluation bar display
  // Always from White's perspective: positive = White, negative = Black
  function getEvaluationBarStyles() {
    if (evaluation.mate !== null) {
      const mateValue = evaluation.mate > 0 ? 5 : -5; // Max out the bar for mate
      const whitePercentage = ((mateValue + 5) / 10) * 100;
      return {
        white: {
          height: `${whitePercentage}%`
        },
        black: {
          height: `${100 - whitePercentage}%`
        }
      };
    }
    let clampedScore = Math.max(Math.min(evaluation.score, 5), -5);
    const whitePercentage = ((clampedScore + 5) / 10) * 100;
    return {
      white: {
        height: `${whitePercentage}%`
      },
      black: {
        height: `${100 - whitePercentage}%`
      }
    };
  }

  // Helper function to format evaluation display
  // Always from White's perspective: + = White advantage, - = Black advantage
  function formatEvaluation() {
    if (evaluation.loading) return "...";
    if (evaluation.error) return `Error: ${evaluation.error}`;
    if (evaluation.mate !== null) {
      const sign = evaluation.mate > 0 ? '+' : '-';
      return `${sign}M${Math.abs(evaluation.mate)}`;
    }
    const sign = evaluation.score >= 0 ? '+' : '-';
    return `${sign}${Math.abs(evaluation.score).toFixed(1)}`;
  }

  // Helper function to analyze a chess position and generate explanations
  function analyzeMoveAndGenerateExplanation(
    fromFen: string, 
    toFen: string, 
    move: { from: string, to: string, san: string }
  ): string {
    const fromGame = new Chess(fromFen);
    const toGame = new Chess(toFen);
    
    // Track material difference
    const fromMaterial = calculateMaterial(fromGame);
    const toMaterial = calculateMaterial(toGame);
    const materialDiff = calculateMaterialDifference(fromMaterial, toMaterial);
    
    // Check for captures
    const isCapture = move.san.includes('x');
    const capturedPiece = isCapture ? getPieceCaptured(fromGame, move) : null;
    
    // Check for checks and checkmates
    const isCheck = toGame.inCheck();
    const isCheckmate = toGame.isCheckmate();
    
    // Check for special moves
    const isCastle = move.san === 'O-O' || move.san === 'O-O-O';
    const isPromotion = move.san.includes('=');
    
    // Check for tactical motifs
    const fork = checkForFork(toGame);
    const pin = checkForPin(toGame);
    const skewer = checkForSkewer(toGame);
    const discoveredAttack = checkForDiscoveredAttack(fromGame, toGame, move);
    
    // Generate explanation based on detected patterns
    if (isCheckmate) {
      return "Checkmate! The game is over.";
    }
    
    if (isPromotion) {
      return `Pawn promotion! ${getColorName(fromGame)} promotes to a ${getPromotionPiece(move.san)}.`;
    }
    
    if (isCastle) {
      return move.san === 'O-O' ? 
        `${getColorName(fromGame)} castles kingside, improving king safety and connecting the rooks.` :
        `${getColorName(fromGame)} castles queenside, seeking king safety while preparing for an attack.`;
    }
    
    if (materialDiff.winner) {
      return `${materialDiff.winner === 'white' ? 'White' : 'Black'} wins material! ${
        materialDiff.description} (${formatMaterialValue(Math.abs(materialDiff.value))})`;
    }
    
    if (fork) {
      return `${getColorName(fromGame, true)} creates a fork! ${fork}`;
    }
    
    if (pin) {
      return `${getColorName(fromGame, true)} creates a pin! ${pin}`;
    }
    
    if (skewer) {
      return `${getColorName(fromGame, true)} creates a skewer! ${skewer}`;
    }
    
    if (discoveredAttack) {
      return `${getColorName(fromGame, true)} launches a discovered attack! ${discoveredAttack}`;
    }
    
    if (isCapture) {
      return `${getColorName(fromGame)} captures ${capturedPiece}.`;
    }
    
    if (isCheck) {
      return `${getColorName(fromGame)} gives check to the ${getColorName(toGame, false)} king.`;
    }
    
    // Default explanations based on piece type
    const pieceType = getPieceType(move.san);
    switch(pieceType) {
      case 'P': return `${getColorName(fromGame)} advances a pawn to control more space.`;
      case 'N': return `${getColorName(fromGame)} develops a knight to a new square.`;
      case 'B': return `${getColorName(fromGame)} repositions the bishop for better diagonal control.`;
      case 'R': return `${getColorName(fromGame)} moves the rook to an ${isOpenFile(toGame, move.to) ? 'open' : 'active'} position.`;
      case 'Q': return `${getColorName(fromGame)} repositions the queen to apply pressure.`;
      case 'K': return `${getColorName(fromGame)} moves the king to a ${isSaferKingSquare(fromGame, toGame, move) ? 'safer' : 'new'} position.`;
      default: return "A move has been played.";
    }
  }

  // Helper functions for move analysis
  function getColorName(game: Chess, capitalize = true): string {
    const color = game.turn() === 'w' ? 'black' : 'white'; // opposite color just moved
    return capitalize ? color.charAt(0).toUpperCase() + color.slice(1) : color;
  }
  
  function getPieceType(san: string): string {
    // Get piece type from SAN notation
    if (san.startsWith('O-O')) return 'K'; // Castling is a king move
    const pieceMatch = san.match(/^([NBRQK])/);
    return pieceMatch ? pieceMatch[1] : 'P'; // Default to pawn if not specified
  }
  
  function calculateMaterial(game: Chess) {
    const pieceValues: Record<string, number> = {
      'p': 1,
      'n': 3,
      'b': 3.25, // slightly higher than knight
      'r': 5,
      'q': 9,
      'k': 0 // king is invaluable
    };
    
    const board = game.board();
    let whiteMaterial = 0;
    let blackMaterial = 0;
    
    board.forEach(row => {
      row.forEach(square => {
        if (square) {
          const value = pieceValues[square.type.toLowerCase()];
          if (square.color === 'w') {
            whiteMaterial += value;
          } else {
            blackMaterial += value;
          }
        }
      });
    });
    
    return { white: whiteMaterial, black: blackMaterial };
  }
  
  function calculateMaterialDifference(before: { white: number, black: number }, after: { white: number, black: number }) {
    const whiteDiff = after.white - before.white;
    const blackDiff = after.black - before.black;
    const netDiff = (after.white - after.black) - (before.white - before.black);
    
    let winner = null;
    let description = "";
    
    if (netDiff > 0) {
      winner = 'white';
      if (blackDiff < 0) {
        // White captured a black piece
        description = getPieceDescription(-blackDiff, 'black');
      }
    } else if (netDiff < 0) {
      winner = 'black';
      if (whiteDiff < 0) {
        // Black captured a white piece
        description = getPieceDescription(-whiteDiff, 'white');
      }
    }
    
    return { 
      value: netDiff, 
      winner, 
      description
    };
  }
  
  function getPieceDescription(value: number, color: string): string {
    // Determine what piece was likely captured based on value
    if (value >= 9) return `${color}'s queen is captured`;
    if (value >= 5) return `${color}'s rook is captured`;
    if (value >= 3) return `${color}'s minor piece is captured`;
    return `${color}'s pawn is captured`;
  }
  
  function formatMaterialValue(value: number): string {
    if (value >= 1) {
      return `+${value.toFixed(1)}`;
    }
    return `${value.toFixed(1)}`;
  }
  
  function getPieceCaptured(game: Chess, move: { from: string, to: string }): string {
    const board = game.board();
    const toFile = move.to.charCodeAt(0) - 97; // Convert 'a'-'h' to 0-7
    const toRank = 8 - parseInt(move.to[1]); // Convert '1'-'8' to 7-0
    
    const piece = board[toRank][toFile];
    if (!piece) return 'a piece';
    
    const pieceNames: Record<string, string> = {
      'p': 'pawn',
      'n': 'knight',
      'b': 'bishop',
      'r': 'rook',
      'q': 'queen',
      'k': 'king'
    };
    
    return `${piece.color === 'w' ? 'white' : 'black'} ${pieceNames[piece.type]}`;
  }
  
  function getPromotionPiece(san: string): string {
    const match = san.match(/=([QRBN])/);
    if (!match) return 'queen';
    
    const pieceNames: Record<string, string> = {
      'Q': 'queen',
      'R': 'rook',
      'B': 'bishop',
      'N': 'knight'
    };
    
    return pieceNames[match[1]];
  }
  
  function isOpenFile(game: Chess, square: string): boolean {
    const file = square.charAt(0);
    const board = game.board();
    
    let pawnsOnFile = 0;
    for (let i = 0; i < 8; i++) {
      const fileIndex = file.charCodeAt(0) - 97; // Convert 'a'-'h' to 0-7
      const piece = board[i][fileIndex];
      if (piece && piece.type === 'p') {
        pawnsOnFile++;
      }
    }
    
    return pawnsOnFile === 0;
  }
  
  function isSaferKingSquare(fromGame: Chess, toGame: Chess, move: { to: string }): boolean {
    // Simple heuristic: If the king moved away from the center, it's likely safer
    const centerDistanceBefore = distanceFromCenter(move.to);
    return centerDistanceBefore > 2; // Further from center is generally safer in middle/endgame
  }
  
  function distanceFromCenter(square: string): number {
    const file = square.charCodeAt(0) - 97; // Convert 'a'-'h' to 0-7
    const rank = parseInt(square[1]) - 1; // Convert '1'-'8' to 0-7
    
    const distX = Math.abs(file - 3.5);
    const distY = Math.abs(rank - 3.5);
    return Math.sqrt(distX * distX + distY * distY);
  }
  
  function checkForFork(game: Chess): string | null {
    // A basic check for knight forks - this is simplified
    // A more comprehensive detection would require deeper analysis
    const board = game.board();
    
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const piece = board[rank][file];
        if (piece && piece.type === 'n') {
          // Check if this knight attacks multiple valuable pieces
          const attacks = getKnightAttacks(file, rank);
          let valuablePiecesAttacked = 0;
          let attackedPieces = [];
          
          for (const attack of attacks) {
            if (attack.file >= 0 && attack.file < 8 && attack.rank >= 0 && attack.rank < 8) {
              const attackedPiece = board[attack.rank][attack.file];
              if (attackedPiece && attackedPiece.color !== piece.color && 
                  (attackedPiece.type === 'k' || attackedPiece.type === 'q' || attackedPiece.type === 'r')) {
                valuablePiecesAttacked++;
                attackedPieces.push(attackedPiece.type === 'k' ? 'king' : 
                                   attackedPiece.type === 'q' ? 'queen' : 'rook');
              }
            }
          }
          
          if (valuablePiecesAttacked >= 2) {
            return `A knight is forking the ${attackedPieces.join(" and ")}.`;
          }
        }
      }
    }
    
    return null;
  }
  
  function getKnightAttacks(file: number, rank: number) {
    return [
      { file: file + 1, rank: rank + 2 },
      { file: file + 2, rank: rank + 1 },
      { file: file + 2, rank: rank - 1 },
      { file: file + 1, rank: rank - 2 },
      { file: file - 1, rank: rank - 2 },
      { file: file - 2, rank: rank + 1 },
      { file: file - 2, rank: rank - 1 },
      { file: file - 1, rank: rank + 2 }
    ];
  }
  
  function checkForPin(game: Chess): string | null {
    // Simplified pin detection - would need more comprehensive analysis for production
    // This is a placeholder for more sophisticated analysis
    return null;
  }
  
  function checkForSkewer(game: Chess): string | null {
    // Simplified skewer detection - would need more comprehensive analysis for production
    // This is a placeholder for more sophisticated analysis
    return null;
  }
  
  function checkForDiscoveredAttack(fromGame: Chess, toGame: Chess, move: { from: string, to: string }): string | null {
    // Simplified discovered attack detection
    // This is a placeholder for more sophisticated analysis
    return null;
  }

  return (
    <div className="flex flex-col md:flex-row w-full max-w-6xl mx-auto gap-6">
      {/* Chessboard - full width on mobile, half on desktop */}
      <div className="w-full md:w-1/2">
        <div className="w-full flex justify-center">
          <div ref={boardContainerRef} className="w-full max-w-[95vw] md:max-w-none flex justify-center items-center">
            {/* Evaluation Bar with label positioned above/below */}
            <EvaluationBar evaluation={evaluation} boardHeight={boardHeight} flipped={boardFlipped} />            <MemoizedChessboard 
              position={fen} 
              width={boardWidth}
              orientation={boardFlipped ? 'black' : 'white'}
              stickers={moveStickers}
            />
          </div>
        </div>
        {/* Flip Board Button */}
        <div className="mt-2 flex justify-center">
          <button
            onClick={() => setBoardFlipped(f => !f)}
            className="px-4 py-2 rounded bg-gray-700 text-white hover:bg-gray-600 transition text-sm flex items-center gap-2"
            aria-label="Flip Board"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.418-5v5h-.582M4 20v-5h.582m15.418 5v-5h-.582M7 10l5-5 5 5M7 14l5 5 5-5"/></svg>
            Flip Board
          </button>
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

        {/* Analysis Controls */}
        <div className="mt-4 flex justify-center items-center">
          <div className="flex items-center space-x-2">
            <label htmlFor="depth-control" className="text-gray-300 text-sm">Depth:</label>
            <select 
              id="depth-control"
              value={engineDepth} 
              onChange={(e) => setEngineDepth(parseInt(e.target.value))}
              className="bg-gray-700 text-white border border-gray-600 rounded py-1 px-2 text-sm"
            >
              {[5, 10, 15, 20].map(depth => (
                <option key={depth} value={depth}>{depth}</option>
              ))}
            </select>
          </div>
        </div>        {/* Sticker Controls - only shown when game is imported */}
        {gameImported && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <div className="text-gray-300 text-sm font-medium">Move Annotations</div>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                onClick={autoAssignStickers}
                disabled={isAnalyzing}
                className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 transition text-xs disabled:opacity-50"
              >
                Quick Annotate
              </button>
              <button
                onClick={autoAssignStickersWithAnalysis}
                disabled={isAnalyzing}
                className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-xs disabled:opacity-50"
              >
                {isAnalyzing ? 'Analyzing...' : 'Deep Analysis'}
              </button>
              <button
                onClick={() => {
                  setMoveStickers([]);
                  setMoveHistory(prev => prev.map(move => {
                    const { sticker, ...rest } = move;
                    return rest;
                  }));
                }}
                disabled={isAnalyzing}
                className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition text-xs disabled:opacity-50"
              >
                Clear All
              </button>
            </div>
            
            {/* Analysis Progress Bar */}
            {isAnalyzing && (
              <div className="w-full max-w-xs">
                <div className="text-xs text-gray-400 text-center mb-1">
                  Analyzing moves... {Math.round(analysisProgress)}%
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                    style={{ width: `${analysisProgress}%` }}
                  ></div>
                </div>
              </div>
            )}            <div className="flex flex-wrap justify-center gap-1 text-xs">
              <span className="flex items-center gap-1 text-green-400">
                <div className="w-4 h-4 bg-green-600 rounded-full flex items-center justify-center text-white">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                </div>
                Best
              </span>
              <span className="flex items-center gap-1 text-green-400">
                <div className="w-4 h-4 bg-green-600 rounded-full flex items-center justify-center text-white">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.5 11L10 13.5l6.5-6.5L18 8.5l-8 8L5.5 12l2-1z"/>
                  </svg>
                </div>
                Excellent
              </span>
              <span className="flex items-center gap-1 text-green-300">
                <div className="w-4 h-4 bg-green-700 rounded-full flex items-center justify-center text-white">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                </div>
                Good
              </span>
              <span className="flex items-center gap-1 text-cyan-400">
                <div className="w-4 h-4 bg-cyan-500 rounded-full flex items-center justify-center text-white">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                </div>
                Brilliant
              </span>
              <span className="flex items-center gap-1 text-blue-400">
                <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center text-white" style={{fontSize: '10px'}}>!</div>
                Great
              </span>
              <span className="flex items-center gap-1 text-yellow-400">
                <div className="w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center text-white" style={{fontSize: '10px'}}>?!</div>
                Inaccuracy
              </span>
              <span className="flex items-center gap-1 text-orange-400">
                <div className="w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center text-white" style={{fontSize: '10px'}}>?</div>
                Mistake
              </span>
              <span className="flex items-center gap-1 text-red-400">
                <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white" style={{fontSize: '10px'}}>??</div>
                Blunder
              </span>
              <span className="flex items-center gap-1 text-red-400">
                <div className="w-4 h-4 bg-red-600 rounded-full flex items-center justify-center text-white">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </div>
                Miss
              </span>
              <span className="flex items-center gap-1 text-green-500">
                <div className="w-4 h-4 bg-green-800 rounded-full flex items-center justify-center text-white">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/>
                  </svg>
                </div>
                Forced
              </span>
            </div>
          </div>
        )}        {/* Move Explanation Panel */}
        {gameImported && currentPosition > 0 && (
          <div className="mt-4 p-3 bg-gray-800 border border-gray-700 rounded-lg shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center">
                <div className="w-4 h-4 bg-blue-500 rounded-full mr-2"></div>
                <h3 className="text-gray-200 text-sm font-semibold">
                  Move {Math.ceil(currentPosition / 2)}.{currentPosition % 2 === 1 ? '' : '..'} {moveHistory[currentPosition - 1]?.san}
                </h3>
              </div>
              {/* Manual annotation dropdown */}
              <select
                value={moveHistory[currentPosition - 1]?.sticker?.type || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value) {
                    assignStickerToCurrentMove(value as ChessMoveSticker['type']);
                  } else {
                    // Remove sticker
                    const moveIndex = currentPosition - 1;
                    setMoveHistory(prev => {
                      const updated = [...prev];
                      if (updated[moveIndex]) {
                        const { sticker, ...rest } = updated[moveIndex];
                        updated[moveIndex] = rest;
                      }
                      return updated;
                    });
                  }
                }}
                className="bg-gray-700 text-white text-xs border border-gray-600 rounded px-2 py-1"
              >
                <option value="">No annotation</option>
                <option value="best">⭐ Best</option>
                <option value="excellent">👍 Excellent</option>
                <option value="good">✓ Good</option>
                <option value="brilliant">⭐ Brilliant</option>
                <option value="great">! Great</option>
                <option value="inaccuracy">?! Inaccuracy</option>
                <option value="mistake">? Mistake</option>
                <option value="blunder">?? Blunder</option>
                <option value="miss">✗ Miss</option>
                <option value="forced">→ Forced</option>
              </select>
            </div>
            <p className="text-gray-300 italic text-sm">
              {currentMoveExplanation || "No explanation available for this move."}
            </p>
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
                      
                      return (                        <tr 
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
                            <div className="flex items-center gap-1">
                              {whiteMove?.san}                              {whiteMove?.sticker && (
                                <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs" 
                                     style={{ backgroundColor: getStickerColor(whiteMove.sticker.type) }}>
                                  {getStickerSymbol(whiteMove.sticker.type)}
                                </div>
                              )}
                            </div>
                          </td>
                          <td 
                            className={`py-2 px-4 cursor-pointer hover:underline ${
                              currentPosition === idx * 2 + 2 ? 'font-bold text-blue-400' : ''
                            }`}
                            onClick={() => blackMove && goToMove(idx * 2 + 1)}
                          >
                            <div className="flex items-center gap-1">
                              {blackMove?.san}                              {blackMove?.sticker && (
                                <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs"
                                     style={{ backgroundColor: getStickerColor(blackMove.sticker.type) }}>
                                  {getStickerSymbol(blackMove.sticker.type)}
                                </div>
                              )}
                            </div>
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
