import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ListingForm } from "@/components/listing-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { InsertListing, Listing } from "@shared/schema";

export default function PostListing() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (data: InsertListing) => {
      const res = await apiRequest("POST", "/api/listings", data);
      return (await res.json()) as Listing;
    },
    onSuccess: (listing) => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings/mine"] });
      toast({
        title: "Listing submitted",
        description: "It'll go live once our team reviews it — usually within a few hours.",
      });
      navigate(`/listings/${listing.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Could not submit listing", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Post a Lobang</CardTitle>
          <CardDescription>
            All listings are reviewed by our team before going live to keep LobangLah! safe for everyone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ListingForm onSubmit={(data) => mutation.mutate(data)} submitting={mutation.isPending} />
        </CardContent>
      </Card>
    </div>
  );
}
