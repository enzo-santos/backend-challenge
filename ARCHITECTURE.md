# Arquitetura do projeto

Este projeto existe para processar transações de apostas sem deixar que detalhes pequenos (como arredondamento de dinheiro, mensagens duplicadas ou duas apostas chegando ao mesmo tempo) deixem o saldo inconsistente. A ideia é que cada operação seja validada, registrada, auditável e repetível sem produzir um débito ou crédito extra.

O caminho escolhido começa no domínio e vai abrindo espaço para o restante do sistema. Primeiro definimos o que é uma operação válida e quais estados ela pode assumir, depois a aplicação coordena essas decisões por meio de use cases, e por último, adapters concretos conectam tudo a PostgreSQL, SQS, NestJS e aos demais serviços. Isso mantém a regra financeira longe de SQL, ORM e detalhes de transporte, além de permitir testar o comportamento principal sem depender de uma infraestrutura inteira.

## Domínio

O projeto usa `Money` em vez de `number` em todos os pontos que representam dinheiro. A implementação usa `Decimal`, rejeita valores infinitos, limita a escala a duas casas decimais e exige moedas com três letras maiúsculas. Quando o valor sai para JSON, ele vira uma string com duas casas, porque a representação precisa continuar estável entre aplicação, banco e mensagens.

Essa decisão também explica por que `Wallet` não expõe uma operação genérica de "alterar saldo". O saldo só muda por meio de `withCredit` e `withDebit`, que validam valor positivo e moeda compatível, recusam saldo negativo e retornam uma nova instância imutável. Cada transição incrementa `version` e atualiza `updatedAt`, deixando explícito que a wallet mudou. A criação de uma wallet com saldo inicial positivo gera uma transação interna `OPENING` e um crédito no ledger. Essa operação é interna e não pode ser submetida por um provider via API ou fila.

`Transaction` é o registro que vincula a operação financeira ao provider, à wallet, ao player, à rodada e ao jogo. Seus campos ficam organizados por contexto (identidade, contexto da aposta, operação, referências, idempotência e ciclo de vida) para que o modelo continue legível conforme cresce. O padrão do projeto é usar propriedades `public readonly`, um objeto local `Args` no construtor e transições que retornam novas instâncias, sem introduzir estado mutável escondido ou dependências de infraestrutura.

Uma transação começa em `PENDING` no fluxo de processamento e pode ficar aguardando uma referência, ser processada ou ser rejeitada. `PROCESSED`, `REJECTED` e `FAILED` são estados terminais: depois que a transação chega a um deles, tentar mudá-la é erro de programação, não uma nova decisão de negócio. Toda rejeição ou falha precisa carregar um `failureCode`, enquanto `REFUND` e `ROLLBACK` precisam apontar para uma referência, salvo quando a própria operação está sendo rejeitada por ter chegado inválida.

As operações financeiras seguem uma regra simples de explicar e importante de preservar. Uma `BET` debita e falha por insuficiência de saldo, uma `WIN` credita, uma `LOSS` registra o resultado sem alterar o saldo, um `REFUND` credita de volta uma `BET` processada, e um `ROLLBACK` desfaz uma `BET`, `WIN` ou `REFUND` processada, invertendo seu efeito. Refund e rollback só podem acontecer uma vez, devem usar o mesmo provider, player, wallet, moeda, rodada e valor da referência, e uma reversão que causaria saldo negativo recebe um código específico, diferente de `INSUFFICIENT_FUNDS`.

O `LedgerItem` é imutável e guarda o saldo antes, a direção, o valor e o saldo depois. O construtor valida que os valores usam a mesma moeda, que os saldos não são negativos, que o valor lançado é positivo e que um crédito satisfaz `balanceBefore + amount = balanceAfter`, enquanto um débito satisfaz `balanceBefore - amount = balanceAfter`. O método `isBalanced()` deixa essa consulta explícita. O ledger é a fonte auditável para reconstruir o saldo; a reconciliação deve apontar divergências, nunca corrigi-las silenciosamente.

## Fluxo da aplicação

Uma entrada HTTP ou uma mensagem SQS deve ser convertida pela camada de interface em um input da aplicação. A aplicação então chama o caso de uso de idempotência, quando a entrada for uma transação externa, e ele envolve o `ProcessTransactionUseCase`. Essa composição deixa cada responsabilidade no lugar certo: o decorator cuida de replay e conflito, enquanto o caso de uso interno decide se a operação pode mexer na wallet e no ledger.

O `ProcessTransactionUseCase` lê a wallet, valida player e moeda, resolve referências por `(providerId, externalId)`, calcula o efeito e usa os métodos do domínio para produzir a nova wallet e a nova transação. Quando há efeito financeiro, ele cria no máximo um lançamento; `LOSS` e transações rejeitadas não geram ledger. Quando a referência ainda não existe, a operação é persistida como `PENDING_REFERENCE` em vez de ser descartada. Cada resultado gera seu evento de transação no Outbox, e uma alteração de saldo gera também `WalletBalanceChanged`.

No desenho final, a persistência da transação, a alteração do saldo e a criação do ledger devem acontecer dentro da mesma Unit of Work. Se a entrada vier do SQS, o Inbox e o Outbox também entram nessa mesma fronteira. O port `UnitOfWork` define essa fronteira sem vazar SQL para a aplicação; a implementação concreta precisa fazer o callback participar de uma transação SQL real.

## Idempotência

O header `Idempotency-Key` é a fonte da verdade. O valor recomendado por padrão é `providerId:externalTransactionId`, mas o servidor deve respeitar a chave que realmente recebeu. Como a mesma chave pode existir em providers diferentes, sua persistência é escopada por `providerId` e `idempotencyKey`.

Antes de procurar um replay, o decorator calcula um SHA-256 de um JSON canônico e estável com os campos de negócio. A chave de idempotência e os metadados de transporte ficam fora desse hash, porque não fazem parte do conteúdo financeiro da operação. Se a chave já existe com o mesmo hash, o resultado armazenado é devolvido com `idempotentReplay: true` e o processamento não acontece novamente. Se a chave existe com outro hash, o sistema devolve `IDEMPOTENCY_CONFLICT`, porque reutilizar a chave para outro payload não é retry válido.

Resultados terminais, inclusive rejeições, são persistidos. `PENDING_REFERENCE` fica fora desse cache porque a referência pode aparecer depois e a transação precisa ser reprocessada. A entidade `Transaction` carrega `idempotencyKey` e `payloadHash`, e o port de idempotência permanece separado mesmo que a implementação de banco possa usar a mesma tabela física de transações. O motivo é manter as responsabilidades claras no código: o banco pode compartilhar a tabela, mas a aplicação não precisa misturar os conceitos.

Essa camada não promete concorrência sozinha. O adapter precisa garantir unicidade, coordenar lookup, processamento e save dentro da transação do banco e lidar com duas requisições chegando juntas. Em outras palavras, o decorator organiza a intenção; `UNIQUE`, lock e Unit of Work são o que transformam essa intenção em garantia.

## Referências pendentes e consultas

Refund e rollback podem chegar antes da transação que referenciam. Em vez de transformar esse caso em uma rejeição definitiva, `ProcessPendingReferencesUseCase` consulta apenas transações `PENDING_REFERENCE` elegíveis para nova tentativa e chama novamente o processamento usando o mesmo id interno. Assim o retry não cria uma segunda transação nem perde os dados originais de idempotência.

A política escolhida é de cinco tentativas, com backoff exponencial começando em um segundo e limitado a sessenta segundos. Quando a última tentativa acaba sem encontrar a referência, o registro vira `REJECTED` com `REFERENCE_NOT_FOUND_RETRY_EXHAUSTED` e um evento de rejeição entra no Outbox. O contador de tentativas, o agendamento e o filtro de registros vencidos pertencem à persistência, não ao scheduler ou ao provider.

As consultas seguem uma separação parecida. A listagem do ledger não carrega tudo para ordenar em memória: o port paginado recebe um cursor tipado e deixa a persistência aplicar a ordenação. Os registros são ordenados por `createdAt` crescente, com `id` como desempate, e o cursor aponta para depois do par `(createdAt, id)` que codifica. A camada HTTP cuida do Base64URL; a aplicação trabalha com o cursor já decodificado. O tamanho padrão é 50 e o máximo é 100. A reconciliação é a exceção intencional, pois precisa poder ler o ledger inteiro para reconstruir o saldo.

## Mensageria

O Inbox existe para lidar com a realidade de que SQS pode entregar a mesma mensagem mais de uma vez. A identidade persistida é `(consumerName, messageId)`, e o hash do payload não inclui esses metadados de transporte. O `ProcessInboxMessageUseCase` tenta fazer um claim atômico, diferencia uma mensagem já processada de um conflito de payload e só marca o registro como processado depois que o handler termina com sucesso. Se o handler falha, o erro continua disponível para que o consumidor escolha retry ou DLQ.

O Outbox resolve o problema complementar: o banco pode confirmar o commit e o processo pode morrer antes de publicar o evento. Por isso o publisher reivindica mensagens vencidas com um lease, publica e grava o próximo estado. Falhas retryable usam backoff; falhas permanentes e tentativas esgotadas deixam a mensagem marcada como falha em vez de apagá-la. Ainda aceitamos que uma publicação possa ser repetida depois de um crash, então consumidores precisam ser idempotentes.

Os eventos previstos pelo README são `WagerTransactionProcessed`, `WagerTransactionRejected`, `WagerTransactionPendingReference` e `WalletBalanceChanged`. Uma operação processada sempre gera o evento da transação, inclusive `LOSS`; o evento de mudança de saldo só aparece quando o saldo realmente muda. As classes concretas são versionadas no domínio e o processamento cria as mensagens de Outbox; a atomicidade do enqueue depende do adapter de persistência participar da mesma Unit of Work.

## Estado atual e pendências

O escopo implementado se concentra no domínio, na aplicação e nos ports. Não há adapter HTTP, consumidor SQS, publisher AWS, schema PostgreSQL, migrations, constraints, índices ou implementação concreta de MikroORM. Isso é intencional: a infraestrutura deve concretizar as garantias do domínio, e não esconder as regras financeiras dentro de controllers ou repositories.

A coordenação de wallet, transação, ledger, Inbox e Outbox com uma Unit of Work real depende da implementação concreta do port. O controle de concorrência por `walletId` também é uma pendência; um fluxo simples de read/calculate/update não resolve duas apostas simultâneas disputando o mesmo saldo em processos diferentes. A persistência precisa garantir unicidade de idempotência, proteção terminal, saldo não negativo no banco e recuperação segura depois de crash.

No domínio, é necessário fechar a validação de uma referência opcional em `WIN`. O erro de rollback que causaria saldo negativo possui código próprio, mas essa garantia depende de uma persistência transacional e concorrente para ser confiável em múltiplas instâncias.

O README também exige logs estruturados, métricas, health checks, shutdown com tratamento de redelivery e testes reais de PostgreSQL, SQS, concorrência e recuperação. Esses itens são pendências; `bun test` não encontra arquivos de teste no momento. Autenticação pertence ao escopo excluído.

A ordem de implementação é uma escolha prática: deixar o domínio impossível de interpretar errado, fechar os use cases, e só então encaixar constraints, locks, leases, commits e adapters concretos. Fazer esse caminho ao contrário tornaria o sistema dependente de um banco específico e dificultaria perceber, no código, por que uma operação financeira é ou não permitida.
