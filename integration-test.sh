#!/bin/bash

# Couleurs pour les messages
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="http://localhost:3000" # URL locale par défaut, peut être changée avec -u
INTEGRATION_MODE="direct" # Mode d'intégration par défaut, peut être "n8n" avec -i
TEST_MODE="basic" # Mode de test par défaut, peut être "advanced" avec -a
REQUEST_ID="test-$(date +%s)"

# Fonction pour afficher les messages
echo_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

echo_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

echo_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

echo_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Afficher l'aide
show_help() {
  echo "Usage: ./integration-test.sh [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  -u, --url URL       URL de l'API MCP (défaut: http://localhost:3000)"
  echo "  -i, --integration   Simuler une intégration avec n8n"
  echo "  -a, --advanced      Exécuter des tests avancés"
  echo "  -h, --help          Afficher cette aide"
  echo ""
  echo "Exemples:"
  echo "  ./integration-test.sh                         # Test basique avec l'API locale"
  echo "  ./integration-test.sh -u https://mon-api.com  # Test avec une API distante"
  echo "  ./integration-test.sh -i                      # Simuler une intégration avec n8n"
  echo "  ./integration-test.sh -a                      # Tests avancés"
}

# Traiter les arguments
while [[ "$#" -gt 0 ]]; do
  case $1 in
    -u|--url) API_URL="$2"; shift ;;
    -i|--integration) INTEGRATION_MODE="n8n" ;;
    -a|--advanced) TEST_MODE="advanced" ;;
    -h|--help) show_help; exit 0 ;;
    *) echo_error "Option inconnue: $1"; show_help; exit 1 ;;
  esac
  shift
done

# Vérifier les prérequis
check_prerequisites() {
  echo_info "Vérification des prérequis..."
  
  if ! command -v curl &> /dev/null; then
    echo_error "curl n'est pas installé. Veuillez l'installer avant de continuer."
    exit 1
  fi
  
  if ! command -v jq &> /dev/null; then
    echo_warning "jq n'est pas installé. Il est recommandé pour traiter les réponses JSON."
    echo_info "Sur macOS: brew install jq"
    echo_info "Sur Ubuntu/Debian: apt-get install jq"
  fi
  
  echo_success "Tous les prérequis sont installés."
}

# Préparation des répertoires de test
prepare_test_env() {
  echo_info "Préparation de l'environnement de test..."
  
  # Créer le répertoire temporaire pour stocker les résultats de test
  mkdir -p ./test-results
  
  echo_success "Environnement de test préparé."
}

# Vérifier le statut de l'API
check_api_status() {
  echo_info "Vérification du statut de l'API MCP..."
  
  RESPONSE=$(curl -s $API_URL/api/status)
  
  if [ $? -ne 0 ]; then
    echo_error "Impossible de se connecter à l'API MCP. Est-elle démarrée?"
    exit 1
  fi
  
  # Sauvegarder la réponse pour analyse
  echo $RESPONSE > ./test-results/status_response.json
  
  echo_info "Réponse de statut reçue: $RESPONSE"
  
  # Vérifier si le serveur est déjà en cours d'exécution
  if echo $RESPONSE | grep -q "\"isRunning\":true"; then
    echo_success "Le serveur MCP est déjà en cours d'exécution."
    IS_RUNNING=true
  else
    echo_info "Le serveur MCP n'est pas en cours d'exécution."
    IS_RUNNING=false
  fi
}

# Démarrer le serveur MCP si nécessaire
start_server() {
  if [ "$IS_RUNNING" = false ]; then
    echo_info "Démarrage du serveur MCP via l'API..."
    
    RESPONSE=$(curl -s -X POST $API_URL/api/start)
    
    echo $RESPONSE > ./test-results/start_response.json
    
    if echo $RESPONSE | grep -q "success"; then
      echo_success "Serveur MCP démarré via l'API"
    else
      echo_error "Échec du démarrage du serveur MCP via l'API: $RESPONSE"
      exit 1
    fi
    
    # Attendre que le serveur soit prêt
    echo_info "Attente que le serveur MCP soit prêt..."
    sleep 5
  else
    echo_info "Le serveur MCP est déjà en cours d'exécution, pas besoin de le démarrer."
  fi
}

# Envoi d'une requête directe à l'API MCP
send_direct_request() {
  echo_info "Envoi d'une requête directe à l'API MCP..."
  
  # Créer un ID de requête unique
  REQUEST_ID="direct-test-$(date +%s)"
  
  # Envoyer la requête
  RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d '{
      "jsonrpc": "2.0",
      "method": "callTool",
      "params": {
        "name": "sequentialthinking",
        "arguments": {
          "thought": "Test direct d'\''intégration avec le serveur MCP",
          "thoughtNumber": 1,
          "totalThoughts": 1,
          "nextThoughtNeeded": false
        }
      },
      "id": "'$REQUEST_ID'"
    }' \
    $API_URL/api/request)
  
  echo $RESPONSE > ./test-results/direct_request_response.json
  
  if echo $RESPONSE | grep -q "success"; then
    echo_success "Requête envoyée avec succès"
    echo_info "ID de requête: $REQUEST_ID"
  else
    echo_error "Échec de l'envoi de la requête: $RESPONSE"
    exit 1
  fi
  
  # Attendre la réponse
  echo_info "Attente de la réponse..."
  sleep 5
  
  # Récupérer la réponse
  RESPONSE=$(curl -s $API_URL/api/response/$REQUEST_ID)
  echo $RESPONSE > ./test-results/direct_response.json
  
  if echo $RESPONSE | grep -q "success"; then
    echo_success "Réponse reçue avec succès"
  else
    echo_warning "Pas de réponse immédiate, cela peut prendre plus de temps"
    echo_info "Vous pouvez vérifier manuellement avec: curl -s $API_URL/api/response/$REQUEST_ID"
  fi
}

# Simulation d'une intégration avec n8n
simulate_n8n_integration() {
  echo_info "[n8n Simulation] Simulation d'intégration avec n8n..."
  
  # Simuler un workflow n8n - Vérification de statut
  echo_info "[n8n Simulation] Vérification du statut du serveur MCP..."
  check_api_status
  
  # Simuler un workflow n8n - Démarrage du serveur si nécessaire
  echo_info "[n8n Simulation] Démarrage du serveur MCP si nécessaire..."
  start_server
  
  # Simuler un workflow n8n - Requête de test
  echo_info "[n8n Simulation] Envoi d'une requête de test séquentielle..."
  
  N8N_REQUEST_ID="n8n-test-$(date +%s)"
  
  # Première pensée
  RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d '{
      "jsonrpc": "2.0",
      "method": "callTool",
      "params": {
        "name": "sequentialthinking",
        "arguments": {
          "thought": "Première pensée du test n8n",
          "thoughtNumber": 1,
          "totalThoughts": 3,
          "nextThoughtNeeded": true
        }
      },
      "id": "'$N8N_REQUEST_ID'-1"
    }' \
    $API_URL/api/request)
  
  if echo $RESPONSE | grep -q "success"; then
    echo_success "[n8n Simulation] Première requête envoyée avec succès"
  else
    echo_error "[n8n Simulation] Échec de l'envoi de la première requête: $RESPONSE"
    exit 1
  fi
  
  sleep 3
  
  # Deuxième pensée
  RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d '{
      "jsonrpc": "2.0",
      "method": "callTool",
      "params": {
        "name": "sequentialthinking",
        "arguments": {
          "thought": "Deuxième pensée du test n8n",
          "thoughtNumber": 2,
          "totalThoughts": 3,
          "nextThoughtNeeded": true
        }
      },
      "id": "'$N8N_REQUEST_ID'-2"
    }' \
    $API_URL/api/request)
  
  if echo $RESPONSE | grep -q "success"; then
    echo_success "[n8n Simulation] Deuxième requête envoyée avec succès"
  else
    echo_warning "[n8n Simulation] Échec de l'envoi de la deuxième requête: $RESPONSE"
  fi
  
  sleep 3
  
  # Troisième pensée
  RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d '{
      "jsonrpc": "2.0",
      "method": "callTool",
      "params": {
        "name": "sequentialthinking",
        "arguments": {
          "thought": "Troisième pensée du test n8n",
          "thoughtNumber": 3,
          "totalThoughts": 3,
          "nextThoughtNeeded": false
        }
      },
      "id": "'$N8N_REQUEST_ID'-3"
    }' \
    $API_URL/api/request)
  
  if echo $RESPONSE | grep -q "success"; then
    echo_success "[n8n Simulation] Troisième requête envoyée avec succès"
  else
    echo_warning "[n8n Simulation] Échec de l'envoi de la troisième requête: $RESPONSE"
  fi
  
  # Simuler un webhook n8n
  if [ "$TEST_MODE" = "advanced" ]; then
    echo_info "[n8n Simulation] Test du webhook pour intégration externe..."
    
    # Simuler une requête entrante sur le webhook n8n
    echo_info "[n8n Simulation] Réception d'une requête sur le webhook n8n..."
    
    # n8n traiterait et formaterait la requête, puis l'enverrait à l'API MCP
    WEBHOOK_ID="webhook-$(date +%s)"
    
    RESPONSE=$(curl -s -X POST \
      -H "Content-Type: application/json" \
      -d '{
        "jsonrpc": "2.0",
        "method": "callTool",
        "params": {
          "name": "sequentialthinking",
          "arguments": {
            "thought": "Requête via webhook simulé",
            "thoughtNumber": 1,
            "totalThoughts": 1,
            "nextThoughtNeeded": false
          }
        },
        "id": "'$WEBHOOK_ID'"
      }' \
      $API_URL/api/request)
    
    if echo $RESPONSE | grep -q "success"; then
      echo_success "[n8n Simulation] Requête webhook traitée et envoyée avec succès"
    else
      echo_warning "[n8n Simulation] Échec du traitement de la requête webhook: $RESPONSE"
    fi
  fi
}

# Vérifier les logs de l'API
check_api_logs() {
  echo_info "Vérification des logs de l'API MCP..."
  
  RESPONSE=$(curl -s $API_URL/api/logs)
  
  if [ $? -eq 0 ]; then
    echo_success "Logs récupérés avec succès"
    echo $RESPONSE > ./test-results/logs_response.json
  else
    echo_warning "Impossible de récupérer les logs"
  fi
}

# Arrêter le serveur MCP
stop_server() {
  echo_info "Arrêt du serveur MCP..."
  
  RESPONSE=$(curl -s -X POST $API_URL/api/stop)
  
  if echo $RESPONSE | grep -q "success"; then
    echo_success "Signal d'arrêt envoyé au serveur MCP"
  else
    echo_warning "Problème lors de l'arrêt du serveur MCP: $RESPONSE"
  fi
  
  # Attendre que le serveur s'arrête
  sleep 3
  
  # Vérifier si le serveur est arrêté
  RESPONSE=$(curl -s $API_URL/api/status)
  
  if echo $RESPONSE | grep -q "\"isRunning\":false"; then
    echo_success "Le serveur MCP s'est arrêté correctement"
  else
    echo_warning "Le serveur MCP semble toujours en cours d'exécution"
  fi
}

# Bilan des tests
print_summary() {
  echo_info "===================================="
  echo_info "        RÉSUMÉ DES TESTS           "
  echo_info "===================================="
  echo_info "Mode d'intégration: $INTEGRATION_MODE"
  echo_info "URL de l'API: $API_URL"
  echo_info "Tests exécutés:"
  echo_info "- Vérification du statut de l'API"
  echo_info "- Démarrage du serveur MCP"
  
  if [ "$INTEGRATION_MODE" = "direct" ]; then
    echo_info "- Envoi d'une requête directe"
  else
    echo_info "- Simulation d'intégration avec n8n"
    echo_info "- Requêtes séquentielles"
    
    if [ "$TEST_MODE" = "advanced" ]; then
      echo_info "- Simulation de webhook"
    fi
  fi
  
  echo_info "- Vérification des logs"
  echo_info "------------------------------------"
  echo_info "Résultats des tests stockés dans: ./test-results/"
  echo_info "===================================="
}

# Gestion des erreurs
handle_error() {
  echo_error "Une erreur s'est produite lors du test."
  exit 1
}

# Trap pour capturer les interruptions
trap handle_error INT TERM

# Exécution principale
main() {
  echo_info "================================================================"
  echo_info "              TEST D'INTÉGRATION MCP SERVER                     "
  echo_info "================================================================"
  
  check_prerequisites
  prepare_test_env
  
  echo_info "Début des tests d'intégration..."
  
  # Vérifier le statut et démarrer le serveur si nécessaire
  check_api_status
  start_server
  
  # Exécuter les tests selon le mode d'intégration
  if [ "$INTEGRATION_MODE" = "direct" ]; then
    send_direct_request
  else
    simulate_n8n_integration
  fi
  
  # Vérifier les logs
  check_api_logs
  
  # Demander à l'utilisateur s'il veut arrêter le serveur
  read -p "Voulez-vous arrêter le serveur MCP? (o/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Oo]$ ]]; then
    stop_server
  fi
  
  # Imprimer un résumé
  print_summary
  
  echo_success "Test d'intégration terminé!"
}

# Exécuter le test
main 