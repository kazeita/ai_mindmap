import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AppV2 from './AppV2.jsx'

const path = window.location.pathname
const isV1 = path === '/v1' || path.startsWith('/v1/')
const Root = isV1 ? App : AppV2

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)