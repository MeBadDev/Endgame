import { useState, useRef, useEffect, useCallback } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';

interface ChessAnalysisProps {}

interface ChessMove {
  from: string;
  to: string;
  san: string;
  fen: string;
  explanation?: string; // Add explanation field
  classification?: MoveClassification;
  bestMove?: string;
  bestMoveScore?: number;
  moveScore?: number;
}

// Added interface for evaluation
interface Evaluation {
  score: number;
  mate: number | null;
  loading: boolean;
}

type MoveClassification = 'book' | 'best' | 'great' | 'brilliant' | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';

// Classification criteria (score difference thresholds in centipawns)
const moveClassifications = {
  best: 0.0, // The engine's best move
  great: 0.2, // Less than 0.2 pawns worse than best move
  good: 0.5, // Less than 0.5 pawns worse than best move
  inaccuracy: 1.0, // Less than 1.0 pawns worse than best move
  mistake: 2.0, // Less than 2.0 pawns worse than best move
  miss: 3.0, // Less than 3.0 pawns worse than best move
  blunder: Infinity, // 3.0+ pawns worse than best move
  brilliant: -0.5, // A move that is initially assessed as worse but turns out to be better
};

export default function ChessAnalysis({}: ChessAnalysisProps) {
  const [game, setGame] = useState(new Chess());
  const [fen, setFen] = useState(game.fen());
  const [history, setHistory] = useState<string[]>([]);
  const [moveHistory, setMoveHistory] = useState<ChessMove[]>([]);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [pgn, setPgn] = useState('');
  const [fenInput, setFenInput] = useState('');
  const [importType, setImportType] = useState<'pgn' | 'fen'>('pgn');
  const [gameImported, setGameImported] = useState(false);
  const [boardWidth, setBoardWidth] = useState(400);
  const [boardHeight, setBoardHeight] = useState(400); // Add state for board height
  const [currentMoveExplanation, setCurrentMoveExplanation] = useState<string>("");
  // Added state for classification progress tracking
  const [classificationProgress, setClassificationProgress] = useState(0);
  const [classificationComplete, setClassificationComplete] = useState(false);
  // Added state for Stockfish and evaluation
  const [stockfish, setStockfish] = useState<any>(null);
  const [evaluation, setEvaluation] = useState<Evaluation>({ score: 0, mate: null, loading: false });
  const [engineDepth, setEngineDepth] = useState(5); // Depth for analysis
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
      const worker = new Worker('/stockfish/stockfish.js');
      setStockfish(worker);
      
      // Initialize Stockfish
      worker.addEventListener('message', (e) => {
        const message = e.data;
        if (!message) return;
        
        // Parse evaluation information from Stockfish output
        if (message.includes('info depth') && message.includes(' score ')) {
          // Extracting score from the message
          try {
            if (message.includes('score cp ')) {
              // Centipawn score
              const scoreMatch = message.match(/score cp (-?\d+)/);
              if (scoreMatch) {
                const score = parseInt(scoreMatch[1]) / 100; // Convert centipawns to pawns
                setEvaluation(prev => ({ ...prev, score, mate: null, loading: false }));
              }
            } else if (message.includes('score mate ')) {
              // Mate score
              const mateMatch = message.match(/score mate (-?\d+)/);
              if (mateMatch) {
                const mate = parseInt(mateMatch[1]);
                setEvaluation(prev => ({ 
                  ...prev, 
                  score: mate > 0 ? 10 : -10, // Display mate as +10 or -10
                  mate, 
                  loading: false 
                }));
              }
            }
          } catch (e) {
            console.error('Error parsing Stockfish evaluation:', e);
          }
        }
      });
      
      // Configure Stockfish
      worker.postMessage('uci');
      worker.postMessage('setoption name MultiPV value 1');
      worker.postMessage('isready');
    }
  }, []);

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
  }, 250), [stockfish, engineDepth]); // 250ms debounce and dependencies

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
        if (moveHistory[moveIndex]) {
          setCurrentMoveExplanation(getMoveExplanationWithClassification(moveHistory[moveIndex]));
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
        // Store the current FEN before making the move
        const prevFen = replayGame.fen();
        
        // Make the move
        replayGame.move({ from: move.from, to: move.to, promotion: move.promotion });
        const currentFen = replayGame.fen();
        
        // Generate an explanation for this move
        const explanation = analyzeMoveAndGenerateExplanation(
          prevFen,
          currentFen,
          { from: move.from, to: move.to, san: move.san }
        );
        
        // Store move with explanation
        moveHistoryWithFen.push({
          from: move.from,
          to: move.to,
          san: move.san,
          fen: currentFen,
          explanation: explanation
        });
        
        fenPositions.push(currentFen);
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
      alert('Invalid PGN format. Please check your input and try again.');
    }
  }
  
  function handleFenImport() {
    try {
      // Validate the FEN string
      const newGame = new Chess();
      // Using try-catch to validate the FEN as load() returns void
      newGame.load(fenInput);
      
      // If we got here, the FEN loaded successfully
      // Create history with just the imported position
      const fenPositions = [newGame.fen()];
      
      // Create a single "move" for the imported position
      const moveHistoryWithFen: ChessMove[] = [{
        from: "", // Empty since this is an imported position
        to: "",   // Empty since this is an imported position
        san: "Imported Position",
        fen: newGame.fen(),
        explanation: "This is an imported position from a FEN string."
      }];
      
      // Set the game states
      setFen(newGame.fen());
      setHistory(fenPositions);
      setMoveHistory(moveHistoryWithFen);
      setCurrentPosition(0);
      setCurrentMoveExplanation("This is an imported position from a FEN string.");
      setGameImported(true);
    } catch (error) {
      alert('Invalid FEN format. Please check your input and try again.');
    }
  }

  function handleImport() {
    if (importType === 'pgn') {
      handlePgnImport();
    } else {
      handleFenImport();
    }
  }
  
  function goToMove(index: number) {
    // Add 1 because index 0 in history is the initial position
    navigateHistory(index + 1);
  }

  // Helper function for evaluation bar display
  function getEvaluationBarStyles() {
    // Clamp the score between -5 and 5 for display purposes
    // Score is from white's perspective, so positive is good for white
    let clampedScore = Math.max(Math.min(evaluation.score, 5), -5);
    // Convert to percentage (0-100) for the CSS height
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
  function formatEvaluation() {
    if (evaluation.loading) return "...";
    
    if (evaluation.mate !== null) {
      return `M${Math.abs(evaluation.mate)}`;
    }
    
    // Show +0.5 for white advantage, -0.5 for black advantage
    const sign = evaluation.score > 0 ? '+' : '';
    return `${sign}${evaluation.score.toFixed(1)}`;
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
      { file: file - 2, rank: rank - 1 },
      { file: file - 2, rank: rank + 1 },
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

  // Check if a move is in a book database using the Lichess API
  async function checkBookMove(fen: string): Promise<{isBook: boolean, bookName?: string}> {
    try {
      const normalizedFen = encodeURIComponent(fen.split(' ').slice(0, 4).join(' '));
      const response = await fetch(`https://explorer.lichess.ovh/master?fen=${normalizedFen}&moves=1&topGames=0`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch from Lichess API');
      }
      
      const data = await response.json();
      const bookMoves = data.moves || [];
      
      if (bookMoves.length > 0 && bookMoves[0].game) {
        return { isBook: true, bookName: bookMoves[0].opening?.name || 'Opening Book Move' };
      } else {
        return { isBook: bookMoves.length > 0, bookName: bookMoves.length > 0 ? 'Opening Book Move' : undefined };
      }
    } catch (error) {
      console.error('Error checking book move:', error);
      return { isBook: false };
    }
  }

  // Analyze a move using Stockfish and classify it
  async function classifyMove(moveIndex: number): Promise<void> {
    if (!stockfish || moveIndex < 0 || moveIndex >= moveHistory.length) return;
    
    // If already classified, don't classify again
    if (moveHistory[moveIndex].classification) {
      // Update progress even if already classified
      setClassificationProgress((prevProgress) => {
        const newProgress = (moveIndex + 1) / moveHistory.length;
        if (newProgress >= 1) {
          setClassificationComplete(true);
        }
        return newProgress;
      });
      return;
    }

    // Get the move that needs to be analyzed
    const move = moveHistory[moveIndex];
    
    // Get the position before the move
    let prevFen = '';
    if (moveIndex === 0) {
      // For the first move, we need to use the initial position
      prevFen = history[0];
    } else {
      prevFen = moveHistory[moveIndex - 1].fen;
    }

    // First check if it's a book move
    // Only check book moves for the first 10 moves to save time
    if (moveIndex < 10) {
      const bookCheck = await checkBookMove(prevFen);
      if (bookCheck.isBook) {
        // Update the move's classification and explanation
        const updatedMoveHistory = [...moveHistory];
        updatedMoveHistory[moveIndex] = {
          ...updatedMoveHistory[moveIndex],
          classification: 'book',
          explanation: bookCheck.bookName || 'Opening Book Move'
        };
        setMoveHistory(updatedMoveHistory);
        
        // Update the progress
        setClassificationProgress((prevProgress) => {
          const newProgress = (moveIndex + 1) / moveHistory.length;
          if (newProgress >= 1) {
            setClassificationComplete(true);
          }
          return newProgress;
        });
        
        return;
      }
    }
    
    // If not a book move, use Stockfish to analyze
    return new Promise<void>((resolve) => {
      // Use the existing stockfish instance instead of creating a new worker
      const evalDepth = 10; // Reduced from 18 to make analysis faster
      
      // Stop any ongoing analysis
      stockfish.postMessage('stop');
      
      // Set up event listener to handle Stockfish's responses
      const handleBestMoveMessage = (e: MessageEvent) => {
        const message = e.data;
        
        if (message.includes('bestmove')) {
          // Extract best move
          const match = message.match(/bestmove\s+(\w+)/);
          if (match) {
            const bestMove = match[1];
            
            // Now get the evaluation of the position after the best move
            stockfish.postMessage('position fen ' + prevFen);
            stockfish.postMessage(`go depth ${evalDepth} searchmoves ` + bestMove);
            
            // Update the event handler to get the evaluation
            stockfish.removeEventListener('message', handleBestMoveMessage);
            
            const handleBestEvalMessage = (e2: MessageEvent) => {
              const evalMessage = e2.data;
              
              if (evalMessage.includes('score cp')) {
                // Extract score for the best move
                const scoreMatch = evalMessage.match(/score cp (-?\d+)/);
                if (scoreMatch) {
                  const bestMoveScore = parseInt(scoreMatch[1]) / 100;
                  
                  // Now get the evaluation of the actual move played
                  const moveFromSquare = move.from;
                  const moveToSquare = move.to;
                  const actualMove = moveFromSquare + moveToSquare;
                  
                  stockfish.postMessage('position fen ' + prevFen);
                  stockfish.postMessage(`go depth ${evalDepth} searchmoves ` + actualMove);
                  
                  stockfish.removeEventListener('message', handleBestEvalMessage);
                  
                  const handleMoveEvalMessage = (e3: MessageEvent) => {
                    const moveEvalMessage = e3.data;
                    
                    if (moveEvalMessage.includes('score cp')) {
                      // Extract score for the played move
                      const moveScoreMatch = moveEvalMessage.match(/score cp (-?\d+)/);
                      if (moveScoreMatch) {
                        const moveScore = parseInt(moveScoreMatch[1]) / 100;
                        
                        // Calculate the difference
                        // The scores are from the side to move's perspective,
                        // so we need to adjust the sign if it's black's move
                        const isWhiteMove = prevFen.includes(' w ');
                        let scoreDiff = isWhiteMove 
                          ? moveScore - bestMoveScore 
                          : bestMoveScore - moveScore;
                        
                        // Classify the move
                        let classification: MoveClassification;
                        
                        if (scoreDiff > 0) {
                          // If the move is better than what the engine suggests, it might be brilliant
                          classification = 'brilliant';
                        } else if (scoreDiff === 0) {
                          // Best move
                          classification = 'best';
                        } else {
                          // Convert to absolute value for comparing to thresholds
                          scoreDiff = Math.abs(scoreDiff);
                          
                          if (scoreDiff <= moveClassifications.great) {
                            classification = 'great';
                          } else if (scoreDiff <= moveClassifications.inaccuracy) {
                            classification = 'inaccuracy';
                          } else if (scoreDiff <= moveClassifications.mistake) {
                            classification = 'mistake';
                          } else if (scoreDiff <= moveClassifications.miss) {
                            classification = 'miss';
                          } else {
                            classification = 'blunder';
                          }
                        }
                        
                        // Update the move history with the new classification
                        const updatedMoveHistory = [...moveHistory];
                        updatedMoveHistory[moveIndex] = {
                          ...updatedMoveHistory[moveIndex],
                          classification,
                          bestMove,
                          bestMoveScore,
                          moveScore
                        };
                        setMoveHistory(updatedMoveHistory);
                        
                        // Update the current explanation if this is the current move
                        if (currentPosition === moveIndex + 1) {
                          setCurrentMoveExplanation(getMoveExplanationWithClassification(updatedMoveHistory[moveIndex]));
                        }
                        
                        // Update the progress
                        setClassificationProgress((prevProgress) => {
                          const newProgress = (moveIndex + 1) / moveHistory.length;
                          if (newProgress >= 1) {
                            setClassificationComplete(true);
                          }
                          return newProgress;
                        });
                        
                        stockfish.removeEventListener('message', handleMoveEvalMessage);
                        resolve();
                      }
                    } else if (moveEvalMessage.includes('bestmove')) {
                      // If we get a bestmove response without a score, use a default classification
                      // This can happen for forced moves or very simple positions
                      const classification: MoveClassification = 'best'; // Default to best move
                      
                      // Update the move history with the new classification
                      const updatedMoveHistory = [...moveHistory];
                      updatedMoveHistory[moveIndex] = {
                        ...updatedMoveHistory[moveIndex],
                        classification,
                        bestMove
                      };
                      setMoveHistory(updatedMoveHistory);
                      
                      // Update the progress
                      setClassificationProgress((prevProgress) => {
                        const newProgress = (moveIndex + 1) / moveHistory.length;
                        if (newProgress >= 1) {
                          setClassificationComplete(true);
                        }
                        return newProgress;
                      });
                      
                      stockfish.removeEventListener('message', handleMoveEvalMessage);
                      resolve();
                    }
                  };
                  
                  stockfish.addEventListener('message', handleMoveEvalMessage);
                }
              } else if (evalMessage.includes('bestmove')) {
                // If we get a bestmove response without a score, use a default classification
                const classification: MoveClassification = 'best'; // Default to best move
                
                // Update the move history with the new classification
                const updatedMoveHistory = [...moveHistory];
                updatedMoveHistory[moveIndex] = {
                  ...updatedMoveHistory[moveIndex],
                  classification,
                  bestMove
                };
                setMoveHistory(updatedMoveHistory);
                
                // Update the progress
                setClassificationProgress((prevProgress) => {
                  const newProgress = (moveIndex + 1) / moveHistory.length;
                  if (newProgress >= 1) {
                    setClassificationComplete(true);
                  }
                  return newProgress;
                });
                
                stockfish.removeEventListener('message', handleBestEvalMessage);
                resolve();
              }
            };
            
            stockfish.addEventListener('message', handleBestEvalMessage);
          }
        }
      };
      
      stockfish.addEventListener('message', handleBestMoveMessage);
      
      // Position and analyze
      stockfish.postMessage('position fen ' + prevFen);
      stockfish.postMessage(`go depth ${evalDepth}`);
    });
  }

  // Generate an explanation that includes the move classification
  function getMoveExplanationWithClassification(move: ChessMove): string {
    if (!move.classification) return move.explanation || "";
    
    const classificationText = getClassificationText(move.classification);
    
    return `${classificationText} ${move.explanation || ""}`;
  }

  // Get text representation of the move classification
  function getClassificationText(classification: MoveClassification): string {
    const classColors = {
      book: "#8A2BE2", // BlueViolet
      best: "#1E90FF", // DodgerBlue
      great: "#32CD32", // LimeGreen
      brilliant: "#FFD700", // Gold
      inaccuracy: "#FFA500", // Orange
      mistake: "#FF4500", // OrangeRed
      miss: "#FF0000", // Red
      blunder: "#8B0000" // DarkRed
    };
    
    const classLabels = {
      book: "Book Move",
      best: "Best Move",
      great: "Great Move",
      brilliant: "Brilliant Move",
      inaccuracy: "Inaccuracy",
      mistake: "Mistake",
      miss: "Miss",
      blunder: "Blunder"
    };
    
    return `<span style="color: ${classColors[classification]}; font-weight: bold;">${classLabels[classification]}:</span>`;
  }

  // Get color for move classification
  function getMoveClassificationColor(classification: MoveClassification): string {
    const classColors = {
      book: "#8A2BE2", // BlueViolet
      best: "#1E90FF", // DodgerBlue
      great: "#32CD32", // LimeGreen
      brilliant: "#FFD700", // Gold
      inaccuracy: "#FFA500", // Orange
      mistake: "#FF4500", // OrangeRed
      miss: "#FF0000", // Red
      blunder: "#8B0000" // DarkRed
    };
    
    return classColors[classification];
  }

  // Classify moves when they are loaded
  useEffect(() => {
    if (gameImported && moveHistory.length > 0 && stockfish) {
      // Reset classification progress
      setClassificationProgress(0);
      setClassificationComplete(false);
      
      // Start a queue to classify moves one by one
      const classifyMoves = async () => {
        for (let i = 0; i < moveHistory.length; i++) {
          // Check if this move is already classified
          if (!moveHistory[i].classification) {
            await classifyMove(i);
          } else {
            // Update progress for already classified moves
            setClassificationProgress((prevProgress) => {
              const newProgress = (i + 1) / moveHistory.length;
              if (newProgress >= 1) {
                setClassificationComplete(true);
              }
              return newProgress;
            });
          }
        }
        
        // Ensure we mark as complete even if all moves were previously classified
        setClassificationComplete(true);
      };
      
      classifyMoves();
    }
  }, [gameImported, moveHistory.length]);

  // Pre-compute evaluations for all positions when classification is complete
  useEffect(() => {
    if (classificationComplete && stockfish && history.length > 0) {
      // Process all positions at a lower depth for quicker feedback
      const quickDepth = 5;
      let currentIndex = 0;
      
      const processNextPosition = () => {
        if (currentIndex < history.length) {
          const position = history[currentIndex];
          
          // Create a one-time listener for this position's evaluation
          const handleQuickEval = (e: MessageEvent) => {
            const message = e.data;
            
            if (message.includes('bestmove')) {
              // Remove this listener as we're done with this position
              stockfish.removeEventListener('message', handleQuickEval);
              
              // Move to next position
              currentIndex++;
              setTimeout(processNextPosition, 0);
            }
          };
          
          stockfish.addEventListener('message', handleQuickEval);
          
          // Evaluate this position
          stockfish.postMessage('stop');
          stockfish.postMessage('position fen ' + position);
          stockfish.postMessage(`go depth ${quickDepth}`);
        }
      };
      
      // Start processing
      processNextPosition();
    }
  }, [classificationComplete, history.length, stockfish]);

  return (
    <div className="flex flex-col md:flex-row w-full max-w-6xl mx-auto gap-6">
      {/* Show progress bar during classification instead of board and move history */}
      {gameImported && !classificationComplete ? (
        <div className="w-full p-8 bg-gray-800 rounded-lg">
          <h2 className="text-xl font-bold mb-4 text-gray-100 text-center">Analyzing game moves...</h2>
          <div className="w-full bg-gray-700 rounded-full h-4 mb-4">
            <div 
              className="bg-blue-600 h-4 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${classificationProgress * 100}%` }}
            ></div>
          </div>
          <p className="text-gray-300 text-center">
            {Math.round(classificationProgress * 100)}% complete
          </p>
          <p className="text-gray-400 text-sm mt-4 text-center">
            Each move is being analyzed and classified. This may take a moment.
          </p>
        </div>
      ) : (
        <>
          {/* Chessboard - full width on mobile, half on desktop */}
          <div className="w-full md:w-1/2">
            <div className="w-full flex justify-center">
              <div ref={boardContainerRef} className="w-full max-w-[95vw] md:max-w-none flex justify-center items-center">
                {/* Evaluation Bar with label positioned above/below */}
                <div className="relative py-2">
                  <div 
                    className="relative w-8 bg-gray-800"
                    style={{ height: `${boardHeight}px` }}
                  >
                    <div 
                      className="absolute bottom-0 w-full bg-white transition-all duration-300 ease-out"
                      style={getEvaluationBarStyles().white}
                    ></div>
                    <div 
                      className="absolute top-0 w-full bg-black transition-all duration-300 ease-out"
                      style={getEvaluationBarStyles().black}
                    ></div>
                    <div className="absolute top-1/2 w-full border-t border-gray-400"></div>
                  </div>
                  
                  {/* Evaluation text - positioned above/below the bar */}
                  <div 
                    className={`absolute w-full text-center text-xs font-bold px-1 py-1 rounded-sm shadow-md
                              ${evaluation.score >= 0 
                                ? 'bottom-[-22px] text-black bg-white/90' 
                                : 'top-[-22px] text-white bg-black/90'}`}
                  >
                    {formatEvaluation()}
                  </div>
                </div>
              
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
            </div>
            
            {/* Move Explanation Panel */}
            {gameImported && currentPosition > 0 && (
              <div className="mt-4 p-3 bg-gray-800 border border-gray-700 rounded-lg shadow-lg">
                <div className="flex items-center mb-1">
                  <div className="w-4 h-4 bg-blue-500 rounded-full mr-2"></div>
                  <h3 className="text-gray-200 text-sm font-semibold">Move Explanation</h3>
                </div>
                <p className="text-gray-300 italic text-sm" dangerouslySetInnerHTML={{ __html: currentMoveExplanation || "No explanation available for this move." }}>
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
                
                {/* Import type toggle */}
                <div className="mb-4 flex justify-center gap-4">
                  <button 
                    onClick={() => setImportType('pgn')} 
                    className={`px-4 py-2 rounded ${
                      importType === 'pgn' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    PGN
                  </button>
                  <button 
                    onClick={() => setImportType('fen')} 
                    className={`px-4 py-2 rounded ${
                      importType === 'fen' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    FEN Position
                  </button>
                </div>
                
                <div className="mb-4 w-full">
                  {importType === 'pgn' ? (
                    <>
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
                    </>
                  ) : (
                    <>
                      <label htmlFor="fen-input" className="block text-sm font-medium text-gray-300 mb-1 text-center">
                        Enter FEN (Forsyth–Edwards Notation)
                      </label>
                      <textarea 
                        id="fen-input"
                        value={fenInput}
                        onChange={(e) => setFenInput(e.target.value)}
                        className="w-full h-40 md:h-32 p-3 border border-gray-600 rounded shadow-sm 
                                bg-gray-700 text-gray-100
                                focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Paste your FEN here... e.g.,
rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
                      ></textarea>
                      <div className="mt-3 text-sm text-gray-400">
                        <p>A FEN string represents a specific chess position.</p>
                        <p>Examples:</p>
                        <ul className="list-disc pl-5 mt-1">
                          <li>Starting position: <span className="text-blue-400">rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1</span></li>
                          <li>After 1.e4: <span className="text-blue-400">rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1</span></li>
                        </ul>
                      </div>
                    </>
                  )}
                </div>
                <button 
                  onClick={handleImport}
                  className="px-8 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition mx-auto"
                  disabled={(importType === 'pgn' && !pgn.trim()) || (importType === 'fen' && !fenInput.trim())}
                >
                  Import {importType === 'pgn' ? 'Game' : 'Position'}
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
                                <span 
                                  dangerouslySetInnerHTML={{
                                    __html: whiteMove?.classification 
                                      ? `<span class="inline-block w-3 h-3 rounded-full mr-1" style="background-color: ${getMoveClassificationColor(whiteMove.classification)}"></span>` 
                                      : ''
                                  }} 
                                />
                                {whiteMove?.san}
                              </td>
                              <td 
                                className={`py-2 px-4 cursor-pointer hover:underline ${
                                  currentPosition === idx * 2 + 2 ? 'font-bold text-blue-400' : ''
                                }`}
                                onClick={() => blackMove && goToMove(idx * 2 + 1)}
                              >
                                {blackMove && (
                                  <>
                                    <span 
                                      dangerouslySetInnerHTML={{
                                        __html: blackMove?.classification 
                                          ? `<span class="inline-block w-3 h-3 rounded-full mr-1" style="background-color: ${getMoveClassificationColor(blackMove.classification)}"></span>` 
                                          : ''
                                      }} 
                                    />
                                    {blackMove.san}
                                  </>
                                )}
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
        </>
      )}
    </div>
  );
}
