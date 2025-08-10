import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import BN from 'bn.js';
import bs58 from 'bs58';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  NameRegistryState,
  getDomainKey,
  getDomainKeySync,
  reverseLookup,
  createInstruction,
  transferInstruction,
  NAME_PROGRAM_ID,
  Numberu64,
  Numberu32,
} from '@bonfida/spl-name-service';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize Solana connection
const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com', 'confirmed');

// Initialize system wallet
const systemWalletPrivateKey = process.env.SYSTEM_WALLET_PRIVATE_KEY;
if (!systemWalletPrivateKey) {
  throw new Error('SYSTEM_WALLET_PRIVATE_KEY is required in environment variables');
}

const systemWallet = Keypair.fromSecretKey(bs58.decode(systemWalletPrivateKey));

// USDC mint address
const USDC_MINT = new PublicKey(process.env.USDC_MINT_ADDRESS || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// SNS Program ID
const SNS_PROGRAM_ID = new PublicKey(process.env.SNS_PROGRAM_ID || '58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx');

// Helper function to get USDC price for domain
async function getDomainPrice(domainName: string): Promise<number> {
  // This is a simplified pricing model - in production you'd want more sophisticated pricing
  const length = domainName.replace('.sol', '').length;
  if (length <= 3) return 10.0;
  if (length <= 5) return 5.0;
  if (length <= 8) return 2.0;
  return 1.0;
}

// Helper function to check if domain is available
async function isDomainAvailable(domainName: string): Promise<boolean> {
  try {
    const domainKey = getDomainKeySync(domainName);
    const domainAccount = await connection.getAccountInfo(domainKey.pubkey);
    return domainAccount === null;
  } catch (error) {
    console.error('Error checking domain availability:', error);
    return false;
  }
}

// GET /sns/check-domain
app.get('/sns/check-domain', async (req: Request, res: Response) => {
  try {
    const { name } = req.query;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Domain name is required' });
    }

    const domainName = name.toLowerCase();
    if (!domainName.endsWith('.sol')) {
      return res.status(400).json({ error: 'Domain must end with .sol' });
    }

    const isAvailable = await isDomainAvailable(domainName);
    const price = await getDomainPrice(domainName);

    res.json({
      domain: domainName,
      available: isAvailable,
      priceUSDC: price,
      message: isAvailable ? 'Domain is available' : 'Domain is already taken'
    });
  } catch (error) {
    console.error('Error checking domain:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /sns/purchase-domain
app.post('/sns/purchase-domain', async (req: Request, res: Response) => {
  try {
    const {
      name,
      buyerPubkey,
      domainPriceUSDC,
      serviceFeeUSDC,
      serviceFeeAddress
    } = req.body;

    // Validate input
    if (!name || !buyerPubkey || !domainPriceUSDC || !serviceFeeUSDC || !serviceFeeAddress) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const domainName = name.toLowerCase();
    if (!domainName.endsWith('.sol')) {
      return res.status(400).json({ error: 'Domain must end with .sol' });
    }

    // Check if domain is available
    const isAvailable = await isDomainAvailable(domainName);
    if (!isAvailable) {
      return res.status(400).json({ error: 'Domain is not available' });
    }

    // Validate price
    const expectedPrice = await getDomainPrice(domainName);
    if (Math.abs(domainPriceUSDC - expectedPrice) > 0.01) {
      return res.status(400).json({ error: 'Invalid domain price' });
    }

    const buyerPublicKey = new PublicKey(buyerPubkey);
    const serviceFeePublicKey = new PublicKey(serviceFeeAddress);

    // Get associated token accounts
    const buyerUsdcAccount = await getAssociatedTokenAddress(USDC_MINT, buyerPublicKey);
    const systemUsdcAccount = await getAssociatedTokenAddress(USDC_MINT, systemWallet.publicKey);
    const serviceFeeUsdcAccount = await getAssociatedTokenAddress(USDC_MINT, serviceFeePublicKey);

    // Get SNS payment account (this would be the official SNS payment address)
    const snsPaymentAccount = new PublicKey('FEEh8bMZ9g6ckxijZeBvXrGmxcFZ5B2MtEvs2X9f6mZh'); // Example SNS payment address

    // Create transaction
    const transaction = new Transaction();

    // Add USDC transfer from buyer to SNS payment account
    const domainPriceLamports = Math.floor(domainPriceUSDC * 1e6); // USDC has 6 decimals
    transaction.add(
      createTransferInstruction(
        buyerUsdcAccount,
        snsPaymentAccount,
        buyerPublicKey,
        domainPriceLamports
      )
    );

    // Add USDC transfer from buyer to service fee address
    const serviceFeeLamports = Math.floor(serviceFeeUSDC * 1e6);
    transaction.add(
      createTransferInstruction(
        buyerUsdcAccount,
        serviceFeeUsdcAccount,
        buyerPublicKey,
        serviceFeeLamports
      )
    );

    // Add SNS domain registration instruction
    const domainKey = getDomainKeySync(domainName);
    const hashedName = domainKey.hashed;
    const createNameRegistryIx = createInstruction(
      NAME_PROGRAM_ID,
      SystemProgram.programId,
      domainKey.pubkey,
      buyerPublicKey,
      systemWallet.publicKey,
      hashedName,
      new Numberu64(domainPriceLamports),
      new Numberu32(2000), // space
      undefined, // nameClassKey
      undefined, // nameParent
      undefined  // nameParentOwner
    );

    transaction.add(createNameRegistryIx);

    // Set fee payer
    transaction.feePayer = systemWallet.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // Sign with system wallet
    transaction.sign(systemWallet);

    // Serialize transaction to base58
    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    });

    res.json({
      success: true,
      transaction: bs58.encode(serializedTransaction),
      transactionBase64: serializedTransaction.toString('base64'), // Keep base64 as fallback
      message: 'Transaction created successfully. User must sign and submit.'
    });

  } catch (error) {
    console.error('Error creating purchase transaction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /sns/update-domain
app.post('/sns/update-domain', async (req: Request, res: Response) => {
  try {
    const { domain, newOwner } = req.body;

    if (!domain || !newOwner) {
      return res.status(400).json({ error: 'Domain and new owner are required' });
    }

    const domainName = domain.toLowerCase();
    const newOwnerPublicKey = new PublicKey(newOwner);

    // Check if domain exists
    const domainKey = getDomainKeySync(domainName);
    const domainAccount = await connection.getAccountInfo(domainKey.pubkey);

    if (!domainAccount) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    // Create update instruction
    const updateInstruction = transferInstruction(
      NAME_PROGRAM_ID,
      domainKey.pubkey,
      newOwnerPublicKey,
      systemWallet.publicKey
    );

    // Create transaction
    const transaction = new Transaction();
    transaction.add(updateInstruction);
    transaction.feePayer = systemWallet.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // Sign with system wallet
    transaction.sign(systemWallet);

    // Serialize transaction
    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    });

    res.json({
      success: true,
      transaction: serializedTransaction.toString('base64'),
      message: 'Update transaction created successfully'
    });

  } catch (error) {
    console.error('Error updating domain:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /sns/lookup
// GET /sns/lookup - Using Bonfida SNS API
app.get('/sns/lookup', async (req: Request, res: Response) => {
  try {
    const { pubkey } = req.query;

    if (!pubkey || typeof pubkey !== 'string') {
      return res.status(400).json({ error: 'Public key is required' });
    }

    // Validate public key format
    let publicKey: PublicKey;
    try {
      publicKey = new PublicKey(pubkey);
    } catch (pubkeyError) {
      return res.status(400).json({ 
        error: 'Invalid public key format',
        details: 'Public key must be a valid base58 string'
      });
    }

    console.log(`Looking up domains for: ${publicKey.toString()}`);

    try {
      const response = await fetch(`https://sns-api.bonfida.com/v2/user/domains/${publicKey.toString()}`);
      
      if (!response.ok) {
        console.log(`Bonfida API failed with status: ${response.status}`);
        return res.status(response.status).json({ 
          error: 'Failed to fetch domains from Bonfida API',
          status: response.status 
        });
      }

      const data = await response.json() as Record<string, string[]>;
      console.log('Bonfida API response:', data);
      
      // Extract domains from the response
      const userDomains = data[publicKey.toString()] || [];
      
      // Add .sol suffix to domain names (API returns without .sol)
      const formattedDomains = userDomains.map(domain => `${domain}.sol`);
      
      console.log(`Found ${formattedDomains.length} domains:`, formattedDomains);
      
      res.json({
        success: true,
        pubkey: publicKey.toString(),
        domains: formattedDomains,
        totalDomains: formattedDomains.length,
        message: formattedDomains.length > 0 ? 
          `Found ${formattedDomains.length} domain(s)` : 
          'No domains found for this public key'
      });

    } catch (fetchError) {
      console.error('Error fetching from Bonfida API:', fetchError);
      res.status(500).json({ 
        error: 'Failed to connect to Bonfida API',
        details: fetchError instanceof Error ? fetchError.message : 'Unknown error'
      });
    }

  } catch (error) {
    console.error('Error looking up domains:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /sns/domain-records - Get all records for a specific domain
app.get('/sns/domain-records', async (req: Request, res: Response) => {
  try {
    const { domain } = req.query;

    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({ error: 'Domain is required' });
    }

    const domainName = domain.toLowerCase();
    if (!domainName.endsWith('.sol')) {
      return res.status(400).json({ error: 'Domain must end with .sol' });
    }

    // Check if domain exists
    const domainKey = getDomainKeySync(domainName);
    const domainAccount = await connection.getAccountInfo(domainKey.pubkey);
    
    if (!domainAccount) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    const nameRegistry = NameRegistryState.deserialize(domainAccount.data);
    const owner = nameRegistry.owner;

    const records: Record<string, any> = {};

    // Try to get records from Bonfida API first
    try {
      const recordsResponse = await fetch(`https://api.bonfida.com/v1/solana/domain/${domainName}/records`);
      if (recordsResponse.ok) {
        const recordsData = await recordsResponse.json() as any;
        if (recordsData && recordsData.result) {
          Object.assign(records, recordsData.result);
        }
      }
    } catch (error) {
      console.log('Bonfida API records fetch failed:', error);
    }

    // Also manually check for common record types
    const recordTypes = ['SOL', 'ETH', 'BTC', 'LTC', 'DOGE', 'URL', 'IPFS', 'ARWV', 'TXT', 'CNAME', 'A', 'AAAA'];
    
    for (const recordType of recordTypes) {
      try {
        const recordKey = await getDomainKey(`${recordType}.${domainName}`);
        const recordAccount = await connection.getAccountInfo(recordKey.pubkey);
        
        if (recordAccount) {
          const recordRegistry = NameRegistryState.deserialize(recordAccount.data);
          if (recordRegistry.data && recordRegistry.data.length > 0) {
            let recordValue = recordRegistry.data.toString('utf8').replace(/\0/g, '');
            
            // Try to clean up the record value
            recordValue = recordValue.trim();
            
            if (recordValue && !records[recordType]) {
              records[recordType] = recordValue;
            }
          }
        }
      } catch (error) {
        // Record doesn't exist, continue
      }
    }

    res.json({
      domain: domainName,
      owner: owner.toString(),
      records: records,
      recordCount: Object.keys(records).length,
      message: 'Domain records retrieved successfully'
    });

  } catch (error) {
    console.error('Error fetching domain records:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /sns/reverse-lookup
app.get('/sns/reverse-lookup', async (req: Request, res: Response) => {
  try {
    const { domain } = req.query;

    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({ error: 'Domain is required' });
    }

    const domainName = domain.toLowerCase();
    if (!domainName.endsWith('.sol')) {
      return res.status(400).json({ error: 'Domain must end with .sol' });
    }

    // Get domain owner
    const domainKey = getDomainKeySync(domainName);
    const domainAccount = await connection.getAccountInfo(domainKey.pubkey);

    if (!domainAccount) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    const nameRegistry = NameRegistryState.deserialize(domainAccount.data);
    const owner = nameRegistry.owner;

    // Get all associated wallet addresses
    const connectedWallets = new Set<string>();
    connectedWallets.add(owner.toString());

    try {
      // Method 1: Try to get records using Bonfida API
      const recordsResponse = await fetch(`https://api.bonfida.com/v1/solana/domain/${domainName}/records`);
      if (recordsResponse.ok) {
        const recordsData = await recordsResponse.json() as any;
        if (recordsData && recordsData.result) {
          // Extract wallet addresses from records
          Object.entries(recordsData.result).forEach(([recordType, recordValue]: [string, any]) => {
            if (recordValue && typeof recordValue === 'string') {
              try {
                // Try to parse as public key
                const pubkey = new PublicKey(recordValue);
                connectedWallets.add(pubkey.toString());
              } catch {
                // Not a valid public key, skip
              }
            }
          });
        }
      }

      // Method 2: Check common record types manually
      const recordTypes = ['SOL', 'ETH', 'BTC', 'LTC', 'DOGE', 'URL', 'IPFS', 'ARWV', 'TXT'];

      for (const recordType of recordTypes) {
        try {
          const recordKey = await getDomainKey(`${recordType}.${domainName}`);
          const recordAccount = await connection.getAccountInfo(recordKey.pubkey);

          if (recordAccount) {
            const recordRegistry = NameRegistryState.deserialize(recordAccount.data);
            if (recordRegistry.data && recordRegistry.data.length > 0) {
              const recordValue = recordRegistry.data.toString('utf8').replace(/\0/g, '');

              // For SOL records, try to parse as public key
              if (recordType === 'SOL' && recordValue) {
                try {
                  const pubkey = new PublicKey(recordValue);
                  connectedWallets.add(pubkey.toString());
                } catch {
                  // Not a valid public key
                }
              }
            }
          }
        } catch (error) {
          // Record doesn't exist, continue
        }
      }

      // Method 3: Try to find subdomains that might contain wallet addresses
      try {
        const subdomainResponse = await fetch(`https://api.bonfida.com/v1/solana/domain/${domainName}/subdomains`);
        if (subdomainResponse.ok) {
          const subdomainData = await subdomainResponse.json() as any;
          if (subdomainData && subdomainData.result && Array.isArray(subdomainData.result)) {
            for (const subdomain of subdomainData.result) {
              try {
                const subdomainKey = getDomainKeySync(subdomain);
                const subdomainAccount = await connection.getAccountInfo(subdomainKey.pubkey);
                if (subdomainAccount) {
                  const subdomainRegistry = NameRegistryState.deserialize(subdomainAccount.data);
                  connectedWallets.add(subdomainRegistry.owner.toString());
                }
              } catch {
                // Skip invalid subdomains
              }
            }
          }
        }
      } catch {
        // Subdomain lookup failed
      }

    } catch (error) {
      console.log('Error fetching additional records:', error);
    }

    const walletArray = Array.from(connectedWallets);

    res.json({
      domain: domainName,
      owner: owner.toString(),
      connectedWallets: walletArray,
      totalConnectedWallets: walletArray.length,
      message: 'Reverse lookup completed with all connected wallets'
    });

  } catch (error) {
    console.error('Error performing reverse lookup:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`SNS Service running on port ${PORT}`);
  console.log(`System wallet: ${systemWallet.publicKey.toString()}`);
  console.log(`USDC Mint: ${USDC_MINT.toString()}`);
  console.log(`SNS Program: ${SNS_PROGRAM_ID.toString()}`);
});
