import Web3 from 'web3'
import ENS from 'ethereum-ens'
import { NETWORK_MAINNET, NETWORK_RINKEBY, ENS_REGISTRIES } from '../constants'
import AragonApp from '@aragon/os/abi/AragonApp.json'

// A plugin to configure the two jwt auth strategies
const web3Plugin = {
  name: 'ns/web3',
  version: '1.0.0',
  register: async function(server, options) {
    server.dependency(['ns/metrics'])

    if (!process.env.ETH_NODE_MAINNET) {
      throw new Error('ETH_NODE_MAINNET env var is required')
    }

    if (!process.env.ETH_NODE_RINKEBY) {
      throw new Error('ETH_NODE_RINKEBY env var is required')
    }

    const web3Mainnet = new Web3(process.env.ETH_NODE_MAINNET)
    const web3Rinkeby = new Web3(process.env.ETH_NODE_RINKEBY)

    const getWeb3 = network =>
      network === NETWORK_MAINNET
        ? web3Mainnet
        : network === NETWORK_RINKEBY
        ? web3Rinkeby
        : null

    const cachedContracts = new Map() // cache map network.contractAddress -> contract instance

    const getContract = (context, { network, contractAddress, abi } = {}) => {
      if (!network) throw new Error('network is required')
      const cacheKey = `${context}.${network}.${contractAddress}`

      if (cachedContracts.has(cacheKey)) {
        return cachedContracts.get(cacheKey)
      }

      const web3 = getWeb3(network)
      const contract = new web3.eth.Contract(abi, contractAddress)
      cachedContracts.set(cacheKey, contract) // save contract to cache

      return contract
    }

    const web3ErrorHandler = (error, network) => {
      server.app.metrics.web3ErrorCounter.labels(network).inc()
      server.log(['error', 'web3'], error)
    }

    const getLatestBlock = async network => {
      if (!network) throw new Error('network is required')

      const web3 = getWeb3(network)
      try {
        return await web3.eth.getBlockNumber()
      } catch (error) {
        web3ErrorHandler(error, network)
        throw error
      }
    }

    const getKernelForApp = async ({ network, contractAddress }) => {
      if (!network) throw new Error('network is required')

      const appContract = getContract('web3', {
        network,
        contractAddress,
        abi: AragonApp.abi,
      })
      try {
        const kernel = await appContract.methods.kernel().call()
        return kernel
      } catch (error) {
        web3ErrorHandler(error, network)
        throw error
      }
    }

    const getAppId = async ({ network, contractAddress } = {}) => {
      if (!network) throw new Error('network is required')

      const appContract = getContract('web3', {
        network,
        contractAddress,
        abi: AragonApp.abi,
      })
      try {
        const appId = await appContract.methods.appId().call()
        return appId
      } catch (error) {
        web3ErrorHandler(error, network)
        throw error
      }
    }

    /**
     * Resolves an ENS name to its address.
     * @param {string} params.name Name to resolve
     * @param {string} params.network Name to resolve
     * @return {Promise} Resolves with the resolved address
     *                   Resolves with an empty string if the name could not be resolved.
     */
    const resolveEnsDomain = async ({ name, network } = {}) => {
      const ens = new ENS(getWeb3(network), ENS_REGISTRIES[network])

      try {
        return await ens.resolver(name).addr()
      } catch (err) {
        if (err.message === 'ENS name not found') {
          return ''
        }
        // Don't know what happened; rethrow
        throw err
      }
    }

    server.app.web3 = {
      getWeb3,
      getContract,
      getAppId,
      getLatestBlock,
      getKernelForApp,
      resolveEnsDomain,
    }
  },
}

export default web3Plugin
