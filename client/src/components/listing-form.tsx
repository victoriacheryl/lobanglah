import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertListingSchema, SG_TOWNS } from "@shared/schema";
import type { InsertListing } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORIES } from "@/lib/format";

export function ListingForm({
  defaultValues,
  onSubmit,
  submitting,
  submitLabel = "Post Lobang",
}: {
  defaultValues?: Partial<InsertListing>;
  onSubmit: (data: InsertListing) => void;
  submitting?: boolean;
  submitLabel?: string;
}) {
  const form = useForm<InsertListing>({
    resolver: zodResolver(insertListingSchema),
    defaultValues: {
      type: defaultValues?.type ?? "seek",
      title: defaultValues?.title ?? "",
      description: defaultValues?.description ?? "",
      category: defaultValues?.category ?? CATEGORIES[0],
      location: defaultValues?.location ?? SG_TOWNS[0],
      price: defaultValues?.price ?? "",
      quantityNeeded: defaultValues?.quantityNeeded ?? 1,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>I am...</FormLabel>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Listing type" data-testid="select-listing-type">
                {([
                  { value: "seek", label: "Seeking a service or product" },
                  { value: "offer", label: "Offering a service or product" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`button-listing-type-${opt.value}`}
                    aria-pressed={field.value === opt.value}
                    onClick={() => field.onChange(opt.value)}
                    className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors text-center ${
                      field.value === opt.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input data-testid="input-title" placeholder="e.g. Need help assembling IKEA wardrobe" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea data-testid="input-description" rows={4} placeholder="Describe what you need or offer, timing, location details, etc." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger data-testid="select-listing-category">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="location"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Location (town)</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger data-testid="select-listing-location">
                      <SelectValue placeholder="Choose a town" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {SG_TOWNS.map((town) => (
                      <SelectItem key={town} value={town}>
                        {town}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="price"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Fee requested / offered (SGD)</FormLabel>
              <FormControl>
                <Input
                  data-testid="input-price"
                  type="text"
                  placeholder="e.g. $50, $80-100, Negotiable, Free"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="quantityNeeded"
          render={({ field }) => (
            <FormItem>
              <FormLabel>How many bids do you want to accept?</FormLabel>
              <FormControl>
                <Input
                  data-testid="input-quantity-needed"
                  type="number"
                  min={1}
                  max={20}
                  step="1"
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                E.g. if you need 3 helpers, set this to 3 — the posting stays open for 7 days, or until you've
                accepted that many bids, whichever earlier.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={submitting} data-testid="button-submit-listing">
          {submitting ? "Saving..." : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
