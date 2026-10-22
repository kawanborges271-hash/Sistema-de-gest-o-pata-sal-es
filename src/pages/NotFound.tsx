import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div>
        <div className="label-caps">Erro 404</div>
        <h1 className="mt-3 font-display text-4xl font-light">Essa página não existe.</h1>
        <Button asChild className="mt-6"><Link to="/agenda">Voltar para a agenda</Link></Button>
      </div>
    </div>
  );
}
