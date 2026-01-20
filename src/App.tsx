import { useMemo, useState, type FormEvent } from 'react'
import {
  AlbedoModule,
  FreighterModule,
  StellarWalletsKit,
  WalletNetwork,
} from '@creit.tech/stellar-wallets-kit'
import {
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import './App.css'

// ------------------------------------------------------------
// CONFIGURACION GENERAL (TESTNET)
// ------------------------------------------------------------
// Horizon es la API HTTP de Stellar. A traves de Horizon:
// - leemos cuentas/balances
// - enviamos transacciones firmadas
// En este workshop trabajamos SOLO en Testnet.
const HORIZON_URL = 'https://horizon-testnet.stellar.org'
// Passphrase de la red Testnet. Debe coincidir con la wallet al firmar.
const NETWORK_PASSPHRASE = Networks.TESTNET
// Cliente de Horizon para hacer requests al servidor testnet.
const server = new Horizon.Server(HORIZON_URL)

function App() {
  // ------------------------------------------------------------
  // Inicializacion del kit de wallets
  // ------------------------------------------------------------
  // Creamos el kit UNA SOLA VEZ y lo reutilizamos.
  // Esto evita que el modal o las referencias internas se reinicien.
  const kit = useMemo(() => {
    return new StellarWalletsKit({
      // Registramos los modulos de wallet que queremos soportar.
      network: WalletNetwork.TESTNET,
      modules: [new FreighterModule(), new AlbedoModule()],
    })
  }, [])

  // ------------------------------------------------------------
  // Eestado de la ui + estado de la wallet
  // ------------------------------------------------------------
  // publicKey: direccion publica seleccionada
  // balance: balance nativo XLM de esa cuenta
  // selectedWallet: nombre de la wallet elegida
  // status: mensajes de estado o errores
  // isConnecting / isSending: flags de carga para deshabilitar botones
  // destination / amount: inputs del formulario de pago
  // lastTxHash: hash de la ultima transaccion enviada
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [destination, setDestination] = useState('')
  const [amount, setAmount] = useState('1')
  const [lastTxHash, setLastTxHash] = useState<string | null>(null)

  // ------------------------------------------------------------
  // Errores
  // ------------------------------------------------------------
  // Transformamos errores desconocidos en un mensaje simple para la UI.
  const handleError = (error: unknown, fallback: string) => {
    if (error instanceof Error) {
      setStatus(error.message)
      return
    }
    if (typeof error === 'string') {
      setStatus(error)
      return
    }
    setStatus(fallback)
  }

  // ------------------------------------------------------------
  // Errores de horizon
  // ------------------------------------------------------------
  // Cuando Horizon devuelve 400, suele incluir result_codes.
  // Aca extraemos esos codigos para mostrar un mensaje mas claro.
  const parseHorizonError = (error: unknown) => {
    if (!error || typeof error !== 'object') return null
    if (!('response' in error)) return null
    const response = (error as { response?: { data?: any } }).response
    const codes = response?.data?.extras?.result_codes
    if (!codes) return null

    const txCode = codes.transaction
    const opCode = Array.isArray(codes.operations) ? codes.operations[0] : null

    if (opCode === 'op_no_destination') {
      return 'La cuenta destino no existe. Usa una cuenta fondeada o crea la cuenta primero.'
    }

    if (txCode === 'tx_bad_seq') {
      return 'Secuencia invalida. Refresca el balance y vuelve a intentar.'
    }

    return `Horizon rechazo la transaccion: ${txCode}${opCode ? ` (${opCode})` : ''}.`
  }

  // ------------------------------------------------------------
  // Balance
  // ------------------------------------------------------------
  // Pedimos a Horizon el balance nativo (XLM) de una cuenta.
  const fetchBalance = async (address: string) => {
    try {
      const account = await server.loadAccount(address)
      const native = account.balances.find((item) => item.asset_type === 'native')
      setBalance(native?.balance ?? '0')
    } catch (error) {
      setBalance(null)
      handleError(
        error,
        'No se pudo cargar el balance. Revisa que la cuenta este fondeada en Testnet.'
      )
    }
  }

  // ------------------------------------------------------------
  // Conexion con la wallet (usando la libreria)
  // ------------------------------------------------------------
  // 1) Abrimos el modal
  // 2) Elegimos wallet
  // 3) Pedimos direccion publica
  // 4) Buscamos balance en Horizon
  const handleConnect = async () => {
    setStatus(null)
    setLastTxHash(null)
    setIsConnecting(true)

    try {
      await kit.openModal({
        onWalletSelected: async (option) => {
          // Guardamos el tipo de wallet seleccionada.
          kit.setWallet(option.id)
          setSelectedWallet(option.name)

          try {
            // Pedimos la direccion publica a la wallet.
            const { address } = await kit.getAddress()
            setPublicKey(address)
            // Una vez que tenemos direccion, consultamos balance.
            await fetchBalance(address)
          } catch (error) {
            handleError(error, 'No se pudo obtener la direccion.')
          } finally {
            setIsConnecting(false)
          }
        },
        onClosed: () => {
          setIsConnecting(false)
        },
      })
    } catch (error) {
      setIsConnecting(false)
      handleError(error, 'No se pudo abrir el selector de wallets.')
    }
  }

  // ------------------------------------------------------------
  // Desconectar
  // ------------------------------------------------------------
  // Limpia el estado de la UI y corta la sesion de la wallet.
  const handleDisconnect = async () => {
    setStatus(null)
    setPublicKey(null)
    setBalance(null)
    setSelectedWallet(null)
    setLastTxHash(null)
    try {
      await kit.disconnect()
    } catch (error) {
      handleError(error, 'No se pudo desconectar la wallet.')
    }
  }

  // ------------------------------------------------------------
  // Transaccion de pago (XLM)
  // ------------------------------------------------------------
  // Flujo paso a paso:
  // 1) Cargar cuenta origen (para obtener sequence number).
  // 2) Construir la transaccion con Operation.payment.
  // 3) Pedir firma a la wallet (kit.signTransaction).
  // 4) Enviar la transaccion firmada a Horizon.
  const handleSendPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus(null)
    setLastTxHash(null)

    if (!publicKey) {
      setStatus('Conecta una wallet primero.')
      return
    }

    if (!destination || !amount) {
      setStatus('Completa el destino y el monto.')
      return
    }

    setIsSending(true)
    try {
      // 1) Cargar cuenta origen (trae el sequence actual).
      const account = await server.loadAccount(publicKey)
      // 2) Construir la transaccion con un pago en XLM.
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.payment({
            destination,
            asset: Asset.native(),
            amount,
          })
        )
        .addMemo(Memo.text('Stellar Wallets Kit'))
        .setTimeout(180)
        .build()

      // 3) Pedir firma a la wallet. La wallet devuelve el XDR firmado.
      const { signedTxXdr } = await kit.signTransaction(transaction.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
      })
      // 4) Enviar el XDR firmado a Horizon para publicarlo en Testnet.
      const signedTx = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)
      const result = await server.submitTransaction(signedTx)

      setLastTxHash(result.hash)
      setStatus('Transaccion enviada a Testnet.')
      await fetchBalance(publicKey)
    } catch (error) {
      const parsed = parseHorizonError(error)
      if (parsed) {
        setStatus(parsed)
        return
      }
      handleError(error, 'No se pudo enviar la transaccion.')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="app">
      <header className="hero">
        <p className="eyebrow">Stellar Wallets Kit</p>
        <h1>Wallet demo Testnet</h1>
        <p className="subtitle">
          Freighter, Albedo y WalletConnect listos para conectar, consultar balance y
          firmar pagos en XLM.
        </p>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h2>Conexion</h2>
          <div className="actions">
            <button onClick={handleConnect} disabled={isConnecting}>
              {isConnecting ? 'Conectando...' : 'Connect Wallet'}
            </button>
            {publicKey ? (
              <button className="secondary" onClick={handleDisconnect}>
                Desconectar
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid">
          <div>
            <div className="label">Wallet seleccionada</div>
            <div className="value">{selectedWallet || 'Sin seleccionar'}</div>
          </div>
          <div>
            <div className="label">Direccion publica</div>
            <div className="value mono">{publicKey || '—'}</div>
          </div>
          <div>
            <div className="label">Balance XLM (Testnet)</div>
            <div className="value">{balance ?? '—'}</div>
          </div>
          <div>
            <div className="label">Fondear cuenta</div>
            <div className="value">
              <a
                href="https://lab.stellar.org/account/fund?$=network$id=testnet&label=Testnet&horizonUrl=https:////horizon-testnet.stellar.org&rpcUrl=https:////soroban-testnet.stellar.org&passphrase=Test%20SDF%20Network%20/;%20September%202015;;"
                target="_blank"
                rel="noreferrer"
              >
                Friendbot
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Pago simple (Testnet)</h2>
          <span className="helper">Se firma y se envia usando la wallet conectada.</span>
        </div>
        <form className="form" onSubmit={handleSendPayment}>
          <label>
            Destino
            <input
              type="text"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="GB..."
            />
          </label>
          <label>
            Monto XLM
            <input
              type="text"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="1"
            />
          </label>
          <button type="submit" disabled={isSending}>
            {isSending ? 'Enviando...' : 'Enviar pago'}
          </button>
        </form>

        {lastTxHash ? (
          <div className="success">
            Hash:{' '}
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${lastTxHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {lastTxHash}
            </a>
          </div>
        ) : null}

        <a
          className="mini-link"
          href="https://lab.stellar.org/account/create?$=network$id=testnet&label=Testnet&horizonUrl=https:////horizon-testnet.stellar.org&rpcUrl=https:////soroban-testnet.stellar.org&passphrase=Test%20SDF%20Network%20/;%20September%202015;;"
          target="_blank"
          rel="noreferrer"
        >
          Crear wallet
        </a>
      </section>

      {status ? <div className="status">{status}</div> : null}
      <footer className="footer">Proyecto de Ticiana Angelucci.</footer>
    </div>
  )
}

export default App
