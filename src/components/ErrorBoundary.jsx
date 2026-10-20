import { Component } from 'react';

// Si un componente falla al pintarse, en vez de una pantalla en blanco se ve
// este aviso. Los datos no se tocan: están cifrados en el dispositivo y basta
// con recargar.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Bóveda: error al pintar la pantalla', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="lock-screen">
        <div className="lock-card">
          <h1>Algo ha fallado</h1>
          <p className="lock-sub">
            La pantalla no se ha podido mostrar. Tus datos están a salvo: siguen cifrados en este dispositivo.
          </p>
          <button className="btn btn-primary btn-block" onClick={() => location.reload()}>
            Recargar la app
          </button>
          <p className="bio-note">Detalle técnico: {String(this.state.error?.message || this.state.error)}</p>
        </div>
      </div>
    );
  }
}
