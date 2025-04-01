import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { ChakraProvider } from '@chakra-ui/react';
import { AuthProvider } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import LobbyPage from './pages/LobbyPage';
import RoomPage from './pages/RoomPage';
import GameLayout from './components/Game/GameLayout';
import './cards.css';

// function RouteLogger() {
//     const location = useLocation();
    
//     useEffect(() => {
//         console.log('Route changed to:', location.pathname);
//     }, [location]);
    
//     return null;
// }

function App() {
    return (
        <ChakraProvider>
            <AuthProvider>
                {/* <RouteLogger /> */}
                <Routes>
                    <Route path="/" element={<LoginPage />} />
                    <Route path="/lobby" element={<LobbyPage />} />
                    <Route path="/room/:id" element={<RoomPage />} />
                    <Route path="/game" element={<GameLayout />} />
                </Routes>
            </AuthProvider>
        </ChakraProvider>
    );
}

export default App;