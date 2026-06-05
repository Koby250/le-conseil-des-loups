import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './ThemeContext';
import Home from './Home';
import MjDashboard from './MjDashboard';
import PlayerScreen from './PlayerScreen';
import './index.css';

function App() {
  return (
    <ThemeProvider>
      <Router>
        <div className="app-container">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/mj/:roomId" element={<MjDashboard />} />
            <Route path="/player/:roomId/:playerNum" element={<PlayerScreen />} />
          </Routes>
        </div>
      </Router>
    </ThemeProvider>
  );
}

export default App;
